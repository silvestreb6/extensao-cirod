/**
 * requestBackup.js - Assistente CIROD
 * Backup automático de requisições do Cfaz para DynamoDB
 * Inclui cálculo incremental de KPIs ao salvar requisições
 */

// Cache com TTL de 5 minutos (usa CacheWithTTL do awsConfig.js)
const fetchCache = new CacheWithTTL(5 * 60 * 1000, 60 * 1000);

// Flag para controlar se os KPIs devem ser atualizados
const ENABLE_KPI_UPDATE = true;

// Flag para controlar se dentistas devem ser criados automaticamente
const ENABLE_AUTO_CREATE_DENTIST = true;

// Cache de dentistas já verificados/criados nesta sessão (TTL de 10 minutos)
const dentistCheckCache = new CacheWithTTL(10 * 60 * 1000, 60 * 1000);

// ========== INICIALIZAÇÃO ==========
// Cfaz é um SPA que usa Turbo - usar apenas turbo:load
document.addEventListener("turbo:load", initializeScript);

function initializeScript() {
  // Verificar se estamos em uma página de requisição específica (com ID numérico na URL)
  const urlPath = window.location.pathname;
  const requestIdMatch = urlPath.match(/\/requests\/(\d+)/);

  if (!requestIdMatch) {
    // Estamos na listagem de requisições, não em uma requisição específica
    console.log("[CIROD] Página de listagem de requisições detectada, ignorando backup");
    return;
  }

  console.log("[CIROD] requestBackup.js carregado - URL:", window.location.href);
  console.log("[CIROD] Request ID detectado na URL:", requestIdMatch[1]);
  initializeBackup();
}

function initializeBackup() {
  const request_idElement = document.querySelector("[data-request-id]");
  if (request_idElement) {
    const request_id = request_idElement.getAttribute("data-request-id");
    console.log("[CIROD] Elemento data-request-id encontrado:", request_id);
    processRequest(request_id);
  } else {
    console.log("[CIROD] Elemento data-request-id NÃO encontrado, aguardando DOM...");
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node.querySelector("[data-request-id]");
              if (el) {
                console.log("[CIROD] Elemento data-request-id encontrado via MutationObserver");
                observer.disconnect();
                initializeBackup();
              }
            }
          });
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout para evitar espera infinita
    setTimeout(() => {
      observer.disconnect();
      console.log("[CIROD] Timeout: elemento data-request-id não encontrado após 10s");
    }, 10000);
  }
}

/**
 * Verifica se o dentista existe no DynamoDB e cria se não existir
 * @param {Object} dentistData - Dados do dentista extraídos do request
 * @returns {Promise<boolean>} - true se o dentista existe ou foi criado com sucesso
 */
async function ensureDentistExists(dentistData) {
  const dentistId = dentistData?.dentist_id;
  if (!dentistId) {
    console.log("[CIROD] ensureDentistExists: dentist_id não disponível");
    return false;
  }

  // Verificar cache para evitar verificações repetidas
  const cacheKey = `dentist_${dentistId}`;
  if (dentistCheckCache.has(cacheKey)) {
    console.log(`[CIROD] Dentista ${dentistId} já verificado nesta sessão (cache)`);
    return true;
  }

  try {
    // Tentar buscar o dentista pelo ID
    const getResponse = await sendServiceMessage({
      command: "get",
      collection: "dentists",
      docId: String(dentistId)
    });

    // Se a operação foi cancelada por navegação, retornar
    if (getResponse.status === 'cancelled') {
      return false;
    }

    // Se o dentista já existe, marcar no cache e retornar
    if (getResponse.status === 'success' && getResponse.data) {
      console.log(`[CIROD] Dentista ${dentistId} já existe no DynamoDB`);
      dentistCheckCache.set(cacheKey, true);
      return true;
    }

    // Se status é 'not_found', prosseguir para criar o dentista

    // Dentista não existe - criar novo registro
    console.log(`[CIROD] Dentista ${dentistId} não encontrado, criando novo registro...`);

    const newDentist = {
      dentist_id: String(dentistId),
      dentist_name: dentistData.dentist_name || "Nome não informado",
      dentist_cro: dentistData.dentist_cro || null,
      dentist_email: dentistData.dentist_email || [],
      commercial_phone: dentistData.commercial_phone || null,
      mobile_phone: dentistData.mobile_phone || null,
      home_phone: dentistData.home_phone || null,
      comment: dentistData.comment || null,
      dental_clinics: dentistData.dental_clinics || [],
      actual_partnership_status: "Parceria em teste", // Status inicial padrão
      KPIs: {
        expectedMonthlyRevenue: 0,
        expectedMonthlyQtd: 0,
        periodKPIs: {}
      },
      created_at: new Date().toISOString(),
      auto_created: true // Flag para identificar dentistas criados automaticamente
    };

    const putResponse = await sendServiceMessage({
      command: "put",
      collection: "dentists",
      docId: String(dentistId),
      data: newDentist
    });

    if (putResponse.status === 'cancelled') {
      return false;
    }

    console.log(`[CIROD] Dentista ${dentistId} (${newDentist.dentist_name}) criado com sucesso no DynamoDB`);
    dentistCheckCache.set(cacheKey, true);
    return true;

  } catch (error) {
    console.error(`[CIROD] Erro ao verificar/criar dentista ${dentistId}:`, error.message);
    return false;
  }
}

function getFileReference(downloadUrl) {
  if (!downloadUrl) return null;
  const urlLower = downloadUrl.toLowerCase();

  if (urlLower.includes("panoramica___6_periapicais")) {
    return "Panorâmica com 6 periapicais";
  } else if (urlLower.includes("periapical_completo___4bites")) {
    return "Periapical Completo com Interproximais";
  } else if (urlLower.includes("pedido_de_exames__frente")) {
    return "Pedido de exames (Frente)";
  } else if (urlLower.includes("pedido_de_exames__verso")) {
    return "Pedido de exames (Verso)";
  } else if (urlLower.includes("periapicais_isoladas") || urlLower.includes("periapical_isolada")) {
    return "Periapicais Isoladas";
  } else if (urlLower.includes("punho_e_mao")) {
    return "Punho e Mão";
  } else if (urlLower.includes("cefalometria")) {
    return "Telerradiografia lateral";
  } else if (urlLower.includes("panoramica")) {
    return "Radiografia Panorâmica";
  } else if (urlLower.includes("periapical_completo")) {
    return "Periapical Completo";
  } else {
    return null;
  }
}

async function processRequest(request_id) {
  if (!request_id) {
    console.log("[CIROD] processRequest: request_id vazio ou inválido");
    return;
  }

  if (fetchCache.has(request_id)) {
    console.log("[CIROD] processRequest: requisição", request_id, "já processada (cache)");
    return;
  }

  console.log("[CIROD] Iniciando processamento da requisição:", request_id);

  try {
    const requestUrl = `/requests/${request_id}.json`;
    console.log("[CIROD] Buscando dados da API:", requestUrl);
    const response = await fetch(requestUrl, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Erro na requisição para ${requestUrl}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("[CIROD] Dados recebidos da API para requisição:", request_id);
    fetchCache.set(request_id, data);

    // Mapear dados da requisição
    const mappedRequestData = {
      request_id: data.id || null,
      request_date: data.date || null,
      billed_request: data.billed_request === true,
      sequential_id: data.sequential_id || null,
      gto_code: data.guide_number || null,
      request_status_id: data.request_status_id || null,
      request_status_name: data.request_status_id && Array.isArray(data.statuses)
        ? data.statuses.find((status) => status.id === data.request_status_id)?.name || null
        : null,
      request_alert: data.alert_request || null,
      share_url: data.share_url || null,
      delivery_address_id: data.delivery_address_id || null,
      patient: {
        patient_id: data.patient?.id || null,
        name: data.patient?.name || null,
        email: data.patient?.email || null,
        birthdate: data.patient?.birthdate || null,
        mobile_phone: data.patient?.mobile_phone || null,
        cpf: data.patient?.cpf || null,
        gender: data.patient?.write_gender || null,
        patient_health_insurances: data.patient?.patient_health_insurances?.map((insurance) => ({
          health_insurance_id: insurance.health_insurance_id || null,
          health_insurance_name: insurance.name || null,
          card_number: insurance.card_number || null,
          company_name_to_gto: insurance.company_name || null,
        })) || [],
      },
      dentist: {
        dentist_id: data.dentist?.id || null,
        dentist_name: data.dentist?.name || null,
        dentist_cro: data.dentist?.cro || null,
        dentist_email: (() => {
          const raw = data.dentist?.email;
          if (!raw) return [];
          if (typeof raw === "string") return raw.split(",").map(e => e.trim()).filter(Boolean);
          if (Array.isArray(raw)) return raw.map(e => String(e).trim()).filter(Boolean);
          return [];
        })(),
        commercial_phone: data.dentist?.commercial_phone || null,
        mobile_phone: data.dentist?.mobile_phone || null,
        home_phone: data.dentist?.home_phone || null,
        comment: data.dentist?.comment || null,
        dental_clinics: data.dentist?.addresses?.map((address) => ({
          clinic_id: address?.id || null,
          street: address?.street || null,
          number: address?.number || null,
          cep: address?.cep || null,
          neighborhood: address?.neighborhood || null,
          city: address?.city || null,
          state: address?.state || null,
          country: address?.country || "Brasil",
          complement: address?.complement || null,
          description: address.description || null,
          phone: address.phone || null,
          created_at: address.created_at || null,
          updated_at: address.updated_at || null,
        })) || [],
      },
      procedures: data.procedure_requests?.map((procedure) => ({
        procedure_id: procedure.id,
        name: procedure.name,
        quantity: procedure.quantity || null,
        price: procedure.price || null,
        health_insurance_id: procedure.health_insurance_id || null,
        health_insurance_name: procedure.health_insurance_string || null,
        tecnico: procedure.tecnico || null,
      })) || [],
      documents: data.documents?.map((document) => {
        const mappedDocument = {};
        Object.keys(document || {}).forEach((key) => {
          if (document[key] !== null && document[key] !== undefined) {
            mappedDocument[key] = document[key];
          }
        });
        mappedDocument.file_reference = getFileReference(document.download_url || "");
        return mappedDocument;
      }) || [],
      financial_postings: data.financial_postings?.map((financial) => ({
        id: financial.id || null,
        health_insurance_id: financial.health_insurance_id || null,
        financial_transaction_type_name: financial.financial_transaction_type_name || null,
        write_status: financial.write_status || null,
        first_transaction_date: financial.transaction_date || null,
        total: financial.total || null,
        discount: financial.discount || null,
      })) || [],
      total_value: data.total_value || null,
      discount: data.discount || null,
      audit: data.created_by_user ? {
        created_by_user_id: data.created_by_user.id || null,
        created_by_user_name: data.created_by_user.name || null,
        created_at: data.created_by_user.created_at || null,
        updated_at: data.created_by_user.updated_at || null,
      } : null,
    };

    // Extrair creation_date e creation_time
    const formattedCreationDate = data?.formatted_creation_date || "";
    let creation_date = "";
    let creation_time = "";
    if (formattedCreationDate.includes(" ")) {
      const [datePart, timePart] = formattedCreationDate.split(" ", 2);
      creation_date = datePart || "";
      creation_time = timePart || "";
    } else {
      creation_date = formattedCreationDate;
    }

    // Criar creation_date_inv (YYYY-MM-DD)
    let creation_date_inv = "";
    if (creation_date) {
      const parts = creation_date.split("/");
      if (parts.length === 3) {
        creation_date_inv = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    mappedRequestData.creation_date = creation_date;
    mappedRequestData.creation_time = creation_time;
    mappedRequestData.creation_date_inv = creation_date_inv;

    // Clinic
    mappedRequestData.clinic = {
      id: data?.clinic?.id || null,
      name: data?.clinic?.name || null,
    };

    // Patient email e age
    if (mappedRequestData.patient) {
      const rawEmail = mappedRequestData.patient.email;
      if (typeof rawEmail === "string") {
        mappedRequestData.patient.email = rawEmail.split(",").map(e => e.trim()).filter(Boolean);
      } else if (!Array.isArray(rawEmail)) {
        mappedRequestData.patient.email = [];
      }
      mappedRequestData.patient.age_years = data?.patient?.age?.years ?? null;
      mappedRequestData.patient.age_months = data?.patient?.age?.months ?? null;
    }

    // Enviar para DynamoDB via service_worker (usando sendServiceMessage do awsConfig.js)
    try {
      const response = await sendServiceMessage({
        command: "put",
        collection: "requests",
        docId: `${request_id}`,
        data: mappedRequestData,
      });

      // Se a operação foi cancelada por navegação, apenas retornar
      if (response.status === 'cancelled') {
        console.log("[CIROD] Operação de backup cancelada por navegação");
        return;
      }

      console.log("[CIROD] Requisição salva no DynamoDB com sucesso:", request_id);
      fetchCache.set(request_id, true);

      // Garantir que o dentista existe antes de calcular KPIs
      if (ENABLE_AUTO_CREATE_DENTIST && mappedRequestData.dentist?.dentist_id) {
        try {
          await ensureDentistExists(mappedRequestData.dentist);
        } catch (dentistError) {
          console.error("[CIROD] Erro ao verificar/criar dentista:", dentistError);
        }
      }

      // Atualizar KPIs do dentista (cálculo incremental)
      if (ENABLE_KPI_UPDATE && window.CIRODKPICalculator) {
        try {
          await window.CIRODKPICalculator.updateDentistKPIs(mappedRequestData);
        } catch (kpiError) {
          console.error("[CIROD] Erro ao atualizar KPIs:", kpiError);
        }
      }
    } catch (saveError) {
      console.error("[CIROD] Erro ao salvar no DynamoDB:", saveError.message);
    }

  } catch (error) {
    console.error(`[CIROD] Erro ao processar requisição ${request_id}:`, error);
  }
}
