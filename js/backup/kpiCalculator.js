/**
 * kpiCalculator.js - Assistente CIROD
 * Calcula e atualiza KPIs incrementalmente ao salvar requisições
 *
 * IMPORTANTE: Este script não deve atualizar KPIs para requisições já existentes.
 * O requestBackup.js já verifica via fetchCache se a requisição foi processada.
 * Aqui mantemos um cache adicional para evitar duplicações em edge cases.
 */

// Importar configuração das unidades CIROD (disponível via awsConfig.js)
// CIROD_UNITS já está disponível globalmente

// Cache de requisições já processadas para KPIs nesta sessão (TTL de 10 minutos)
// Usa CacheWithTTL do awsConfig.js
const kpiProcessedRequests = new CacheWithTTL(10 * 60 * 1000, 60 * 1000);

/**
 * Atualiza os KPIs do dentista após salvar uma requisição
 * @param {Object} requestData - Dados da requisição salva
 */
async function updateDentistKPIs(requestData) {
  // Tratar string vazia como null para CRO
  const dentistCro = requestData?.dentist?.dentist_cro || null;
  const dentistId = requestData?.dentist?.dentist_id;

  // Verificar se temos pelo menos um identificador válido (CRO ou ID)
  if (!requestData || (!dentistCro && !dentistId)) {
    console.log('[CIROD KPI] Requisição sem CRO e sem ID do dentista, ignorando cálculo de KPIs');
    return;
  }

  const requestId = String(requestData.request_id);

  // Verificar se já processamos esta requisição nesta sessão
  if (kpiProcessedRequests.has(requestId)) {
    console.log(`[CIROD KPI] Requisição ${requestId} já processada nesta sessão, ignorando`);
    return;
  }

  // Marcar como processada imediatamente para evitar race conditions
  kpiProcessedRequests.set(requestId, true);

  const clinicId = requestData.clinic?.id;
  const totalValue = parseFloat(requestData.total_value) || 0;
  const creationDateInv = requestData.creation_date_inv; // YYYY-MM-DD

  if (!creationDateInv) {
    console.log('[CIROD KPI] Requisição sem data, ignorando cálculo de KPIs');
    return;
  }

  // Extrair ano e mês
  const [year, month] = creationDateInv.split('-');
  if (!year || !month) {
    console.log('[CIROD KPI] Data inválida:', creationDateInv);
    return;
  }

  // Determinar identificador para log
  const identifier = dentistCro || `ID:${dentistId}`;
  console.log(`[CIROD KPI] Atualizando KPIs para dentista ${identifier}, Unidade: ${clinicId}, Valor: R$${totalValue}`);

  try {
    // Buscar dentista pelo CRO ou pelo ID
    let dentist = null;
    if (dentistCro) {
      dentist = await findDentistByCro(dentistCro);
    }
    if (!dentist && dentistId) {
      console.log(`[CIROD KPI] Dentista não encontrado por CRO, tentando por ID: ${dentistId}`);
      dentist = await findDentistById(dentistId);
    }

    if (!dentist) {
      // Dentista não existe - criar automaticamente usando dados do request
      console.log(`[CIROD KPI] Dentista ${identifier} não encontrado, criando automaticamente...`);

      const dentistData = requestData.dentist;
      const newDentist = {
        dentist_id: String(dentistId),
        dentist_name: dentistData?.dentist_name || "Nome não informado",
        dentist_cro: dentistCro || null,
        dentist_email: dentistData?.dentist_email || [],
        commercial_phone: dentistData?.commercial_phone || null,
        mobile_phone: dentistData?.mobile_phone || null,
        home_phone: dentistData?.home_phone || null,
        comment: dentistData?.comment || null,
        dental_clinics: dentistData?.dental_clinics || [],
        actual_partnership_status: "Parceria em teste",
        KPIs: {
          expectedMonthlyRevenue: 0,
          expectedMonthlyQtd: 0,
          periodKPIs: {}
        },
        created_at: new Date().toISOString(),
        auto_created: true
      };

      try {
        await sendServiceMessage({
          command: "put",
          collection: "dentists",
          docId: String(dentistId),
          data: newDentist
        });
        console.log(`[CIROD KPI] Dentista ${newDentist.dentist_name} criado com sucesso`);
        dentist = newDentist;
      } catch (createError) {
        console.error(`[CIROD KPI] Erro ao criar dentista: ${createError.message}`);
        return;
      }
    }

    // Obter KPIs existentes ou criar estrutura
    const existingKPIs = dentist.KPIs || {
      expectedMonthlyRevenue: 0,
      expectedMonthlyQtd: 0,
      periodKPIs: {}
    };

    // Garantir que a estrutura do período existe
    if (!existingKPIs.periodKPIs) {
      existingKPIs.periodKPIs = {};
    }
    if (!existingKPIs.periodKPIs[year]) {
      existingKPIs.periodKPIs[year] = {};
    }
    if (!existingKPIs.periodKPIs[year][month]) {
      existingKPIs.periodKPIs[year][month] = createEmptyMonthKPIs();
    }

    const monthKPIs = existingKPIs.periodKPIs[year][month];

    // Atualizar totais gerais do mês
    monthKPIs.faturamentoTotalMes = (monthKPIs.faturamentoTotalMes || 0) + totalValue;
    monthKPIs.totalPedidos = (monthKPIs.totalPedidos || 0) + 1;

    // Calcular ticket médio
    if (monthKPIs.totalPedidos > 0) {
      monthKPIs.avgTicket = monthKPIs.faturamentoTotalMes / monthKPIs.totalPedidos;
    }

    // Atualizar KPIs por unidade se tivermos o ID da clínica
    if (clinicId && typeof CIROD_UNITS !== 'undefined') {
      const unit = CIROD_UNITS.find(u => u.id === clinicId);
      if (unit) {
        const faturamentoField = `faturamento${unit.fieldSuffix}`;
        const pedidosField = `totalPedidos${unit.fieldSuffix}`;

        monthKPIs[faturamentoField] = (monthKPIs[faturamentoField] || 0) + totalValue;
        monthKPIs[pedidosField] = (monthKPIs[pedidosField] || 0) + 1;

        console.log(`[CIROD KPI] Unidade ${unit.name}: +R$${totalValue} (${faturamentoField})`);
      } else {
        console.log(`[CIROD KPI] Unidade ID ${clinicId} não mapeada nas unidades CIROD`);
      }
    }

    // Recalcular expectativas baseadas no histórico
    recalculateExpectations(existingKPIs);

    // Salvar KPIs atualizados
    await saveDentistKPIs(dentist.dentist_id, existingKPIs);

    console.log(`[CIROD KPI] KPIs atualizados com sucesso para dentista ${dentist.dentist_name} (${year}/${month})`);

  } catch (error) {
    console.error('[CIROD KPI] Erro ao atualizar KPIs:', error);
    // Em caso de erro, remover do cache para permitir nova tentativa
    kpiProcessedRequests.delete(requestId);
  }
}

/**
 * Cria estrutura vazia de KPIs para um mês
 */
function createEmptyMonthKPIs() {
  const emptyKPIs = {
    faturamentoTotalMes: 0,
    totalPedidos: 0,
    avgTicket: 0
  };

  // Adicionar campos para cada unidade CIROD (se disponível)
  if (typeof CIROD_UNITS !== 'undefined') {
    CIROD_UNITS.forEach(unit => {
      emptyKPIs[`faturamento${unit.fieldSuffix}`] = 0;
      emptyKPIs[`totalPedidos${unit.fieldSuffix}`] = 0;
    });
  }

  return emptyKPIs;
}

/**
 * Recalcula expectativas mensais baseado no histórico
 */
function recalculateExpectations(kpis) {
  const periodKPIs = kpis.periodKPIs || {};

  const monthlyRevenues = [];
  const monthlyQuantities = [];

  // Coletar dados de todos os meses
  Object.values(periodKPIs).forEach(yearData => {
    Object.values(yearData).forEach(monthData => {
      // Apenas considerar meses com faturamento significativo (> R$500)
      if (monthData.faturamentoTotalMes > 500) {
        monthlyRevenues.push(monthData.faturamentoTotalMes);
      }
      // Apenas considerar meses com quantidade significativa (>= 4 pedidos)
      if (monthData.totalPedidos >= 4) {
        monthlyQuantities.push(monthData.totalPedidos);
      }
    });
  });

  // Calcular médias (expectativas)
  if (monthlyRevenues.length > 0) {
    kpis.expectedMonthlyRevenue = Math.round(
      monthlyRevenues.reduce((a, b) => a + b, 0) / monthlyRevenues.length * 100
    ) / 100; // Arredondar para 2 casas decimais
  }

  if (monthlyQuantities.length > 0) {
    kpis.expectedMonthlyQtd = Math.round(
      monthlyQuantities.reduce((a, b) => a + b, 0) / monthlyQuantities.length * 10
    ) / 10; // Arredondar para 1 casa decimal
  }
}

/**
 * Busca dentista pelo CRO no DynamoDB
 * Usa sendServiceMessage do awsConfig.js para comunicação centralizada
 */
async function findDentistByCro(cro) {
  if (!cro) return null;

  try {
    const response = await sendServiceMessage({
      command: 'query',
      collection: 'dentists',
      filters: [
        { field: 'dentist_cro', operator: '=', value: cro }
      ]
    });

    // Se a operação foi cancelada por navegação, retornar null
    if (response.status === 'cancelled') {
      return null;
    }

    // Retornar o primeiro dentista encontrado (CRO deve ser único)
    const dentists = response.data || [];
    return dentists.length > 0 ? dentists[0] : null;
  } catch (error) {
    console.error('[CIROD KPI] Erro ao buscar dentista por CRO:', error.message);
    throw error;
  }
}

/**
 * Busca dentista pelo ID no DynamoDB
 * Usado como fallback quando o CRO não está disponível
 */
async function findDentistById(dentistId) {
  if (!dentistId) return null;

  try {
    const response = await sendServiceMessage({
      command: 'get',
      collection: 'dentists',
      docId: String(dentistId)
    });

    // Se a operação foi cancelada por navegação, retornar null
    if (response.status === 'cancelled') {
      return null;
    }

    // Se não encontrou, retornar null (não é erro)
    if (response.status === 'not_found') {
      return null;
    }

    return response.data || null;
  } catch (error) {
    console.error('[CIROD KPI] Erro ao buscar dentista por ID:', error.message);
    throw error;
  }
}

/**
 * Salva KPIs atualizados do dentista no DynamoDB
 * Usa sendServiceMessage do awsConfig.js para comunicação centralizada
 */
async function saveDentistKPIs(dentistId, kpis) {
  try {
    const response = await sendServiceMessage({
      command: 'update',
      collection: 'dentists',
      docId: String(dentistId),
      data: { KPIs: kpis }
    });

    // Se a operação foi cancelada por navegação, apenas retornar
    if (response.status === 'cancelled') {
      console.log('[CIROD KPI] Salvamento de KPIs cancelado por navegação');
      return;
    }
  } catch (error) {
    console.error('[CIROD KPI] Erro ao salvar KPIs:', error.message);
    throw error;
  }
}

/**
 * Recalcula todos os KPIs de um dentista a partir do zero
 * (útil para correções ou recálculo manual)
 *
 * Uso: window.CIRODKPICalculator.recalculateAllKPIsForDentist('CRO-XXXXX')
 */
async function recalculateAllKPIsForDentist(dentistCro) {
  console.log(`[CIROD KPI] Recalculando todos os KPIs para dentista CRO: ${dentistCro}`);

  try {
    // Buscar dentista
    const dentist = await findDentistByCro(dentistCro);
    if (!dentist) {
      console.error(`[CIROD KPI] Dentista com CRO ${dentistCro} não encontrado`);
      return null;
    }

    // Buscar todas as requisições do dentista
    const requests = await queryRequestsByDentistCro(dentistCro);
    console.log(`[CIROD KPI] Encontradas ${requests.length} requisições para recálculo`);

    // Criar estrutura de KPIs limpa
    const newKPIs = {
      expectedMonthlyRevenue: 0,
      expectedMonthlyQtd: 0,
      periodKPIs: {}
    };

    // Processar cada requisição
    requests.forEach(req => {
      const creationDateInv = req.creation_date_inv;
      if (!creationDateInv) return;

      const [year, month] = creationDateInv.split('-');
      if (!year || !month) return;

      const totalValue = parseFloat(req.total_value) || 0;
      const clinicId = req.clinic?.id;

      // Garantir estrutura
      if (!newKPIs.periodKPIs[year]) {
        newKPIs.periodKPIs[year] = {};
      }
      if (!newKPIs.periodKPIs[year][month]) {
        newKPIs.periodKPIs[year][month] = createEmptyMonthKPIs();
      }

      const monthKPIs = newKPIs.periodKPIs[year][month];

      // Atualizar totais
      monthKPIs.faturamentoTotalMes += totalValue;
      monthKPIs.totalPedidos += 1;

      // Atualizar por unidade
      if (clinicId && typeof CIROD_UNITS !== 'undefined') {
        const unit = CIROD_UNITS.find(u => u.id === clinicId);
        if (unit) {
          monthKPIs[`faturamento${unit.fieldSuffix}`] = (monthKPIs[`faturamento${unit.fieldSuffix}`] || 0) + totalValue;
          monthKPIs[`totalPedidos${unit.fieldSuffix}`] = (monthKPIs[`totalPedidos${unit.fieldSuffix}`] || 0) + 1;
        }
      }
    });

    // Calcular ticket médio para cada mês
    Object.values(newKPIs.periodKPIs).forEach(yearData => {
      Object.values(yearData).forEach(monthData => {
        if (monthData.totalPedidos > 0) {
          monthData.avgTicket = Math.round(monthData.faturamentoTotalMes / monthData.totalPedidos * 100) / 100;
        }
      });
    });

    // Calcular expectativas
    recalculateExpectations(newKPIs);

    // Salvar
    await saveDentistKPIs(dentist.dentist_id, newKPIs);

    console.log(`[CIROD KPI] Recálculo completo para dentista ${dentist.dentist_name}`);
    return newKPIs;

  } catch (error) {
    console.error('[CIROD KPI] Erro ao recalcular KPIs:', error);
    return null;
  }
}

/**
 * Busca todas as requisições de um dentista pelo CRO
 * Usa sendServiceMessage do awsConfig.js para comunicação centralizada
 */
async function queryRequestsByDentistCro(cro) {
  try {
    const response = await sendServiceMessage({
      command: 'queryByDentistCro',
      cro: cro
    });

    // Se a operação foi cancelada por navegação, retornar array vazio
    if (response.status === 'cancelled') {
      return [];
    }

    return response.data || [];
  } catch (error) {
    console.error('[CIROD KPI] Erro ao buscar requisições por CRO:', error.message);
    throw error;
  }
}

// Exportar funções para uso externo
if (typeof window !== 'undefined') {
  window.CIRODKPICalculator = {
    updateDentistKPIs,
    recalculateAllKPIsForDentist,
    createEmptyMonthKPIs
  };
}
