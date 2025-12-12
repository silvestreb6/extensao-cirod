/**
 * saudeParceriasModule.js - Assistente CIROD
 * Módulo de análise de Saúde das Parcerias
 * Analisa a frequência de indicações e status de cada parceria com dentistas
 *
 * Adaptado do módulo Saúde das Parcerias do Auto-X para a estrutura CIROD/DynamoDB
 *
 * Os dados são calculados automaticamente uma vez por dia na primeira visita.
 * Resultados ficam cacheados no DynamoDB para acesso rápido de outros usuários.
 */

(function() {
  'use strict';

  // Constantes
  const CONCURRENCY = 10; // Número de requisições paralelas ao carregar dados
  const PAGE_SIZE = 50;   // Dentistas por página

  // Estado de ordenação
  let sortState = {
    colIndex: 2,        // "Frequência de indicações atual"
    direction: 'asc'    // Ascendente por padrão (menor frequência = mais atenção necessária)
  };

  // Estado de paginação
  let paginationState = {
    currentPage: 1,
    totalPages: 1,
    allRows: []  // Armazena todas as linhas para paginação
  };

  // Cache dos dados de saúde das parcerias (carregado do DynamoDB)
  let cachedHealthData = null;

  // ========== INICIALIZAÇÃO ==========

  /**
   * Inicializa o módulo assim que o script rodar
   * Adiciona o item "Saúde das Parcerias" ao menu "Controles"
   */
  function initPartnershipHealthModule() {
    console.log('[CIROD Saúde] Inicializando módulo Saúde das Parcerias');
    setTimeout(() => createPartnershipHealthItem(), 100);
  }

  /**
   * Cria a opção no dropdown 'Controles'
   */
  function createPartnershipHealthItem() {
    console.log('[CIROD Saúde] Criando item de menu Saúde das Parcerias');

    const navbar = document.getElementById('navbarText');
    if (!navbar) {
      console.warn('[CIROD Saúde] Navbar não encontrada');
      return;
    }

    // Encontrar o menu Controles existente
    const controlsLi = Array.from(navbar.querySelectorAll('.nav-item.dropdown'))
      .find(li => {
        const p = li.querySelector('p');
        return p && p.textContent.trim() === 'Controles';
      });

    if (!controlsLi) {
      console.warn('[CIROD Saúde] Menu Controles não encontrado');
      return;
    }

    const dropdownMenu = controlsLi.querySelector('.dropdown-menu');
    if (!dropdownMenu) {
      console.warn('[CIROD Saúde] Dropdown-menu não encontrado');
      return;
    }

    // Verificar se já existe
    if (dropdownMenu.querySelector("a[href='#partnership_health']")) {
      console.log('[CIROD Saúde] Item já existe, não duplicando');
      return;
    }

    // Criar o item
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'dropdown-item';
    a.href = '#partnership_health';
    a.textContent = 'Saúde das Parcerias';
    li.appendChild(a);
    dropdownMenu.appendChild(li);

    console.log('[CIROD Saúde] Item adicionado ao menu Controles');

    a.addEventListener('click', e => {
      e.preventDefault();

      // Pedir senha de acesso
      const pass = prompt('Digite a senha de acesso:');
      if (!ACCESS_PASSWORDS.includes(pass)) {
        alert('Senha incorreta!');
        return;
      }

      console.log('[CIROD Saúde] Carregando módulo Saúde das Parcerias');
      if (typeof hideMainContent === 'function') hideMainContent();
      clearPartnershipHealthModule();
      loadPartnershipHealthModule();
    });
  }

  /**
   * Remove instância anterior do módulo
   */
  function clearPartnershipHealthModule() {
    console.log('[CIROD Saúde] Limpando instância anterior');
    const prev = document.getElementById('partnershipHealthModule');
    if (prev) prev.remove();
  }

  // ========== FUNÇÕES AUXILIARES ==========

  /**
   * Remove acentos para ordenação correta
   */
  function stripAccents(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Handler de clique no cabeçalho para ordenação
   */
  function onHeaderClick(th) {
    const idx = Number(th.dataset.index);

    if (sortState.colIndex !== idx) {
      // Nova coluna: começa em ascendente
      sortState = { colIndex: idx, direction: 'asc' };
    } else {
      // Mesma coluna: toggle entre asc e desc
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    }

    updateSortIcons();
    applySorting();
  }

  /**
   * Atualiza ícones de ordenação nos cabeçalhos
   */
  function updateSortIcons() {
    document.querySelectorAll('#partnershipHealthModule th.sortable').forEach(th => {
      const icon = th.querySelector('.sort-icon');
      if (!icon) return;

      th.classList.remove('sorted');
      const idx = Number(th.dataset.index);

      if (idx === sortState.colIndex) {
        // Coluna ativa: mostrar direção atual
        th.classList.add('sorted');
        icon.style.opacity = '1';
        icon.innerHTML = sortState.direction === 'asc'
          ? '<i class="fa fa-sort-up"></i>'
          : '<i class="fa fa-sort-down"></i>';
      } else {
        // Coluna inativa: mostrar ícone neutro
        icon.style.opacity = '0.4';
        icon.innerHTML = '<i class="fa fa-sort"></i>';
      }
    });
  }

  /**
   * Reordena as linhas da tabela e reaplica paginação
   */
  function applySorting() {
    if (paginationState.allRows.length === 0) return;
    if (sortState.colIndex == null) return;

    const { colIndex, direction } = sortState;
    const table = document.querySelector('#partnershipHealthModule table');
    const th = table ? table.querySelector(`th[data-index="${colIndex}"]`) : null;
    const type = th ? th.dataset.type : 'string';

    // Ordenar todas as linhas armazenadas
    paginationState.allRows.sort((a, b) => {
      let va = a.children[colIndex]?.textContent.trim() || '';
      let vb = b.children[colIndex]?.textContent.trim() || '';

      if (type === 'number') {
        let na = parseFloat(va);
        let nb = parseFloat(vb);
        na = isNaN(na) ? (direction === 'asc' ? Infinity : -Infinity) : na;
        nb = isNaN(nb) ? (direction === 'asc' ? Infinity : -Infinity) : nb;
        va = na;
        vb = nb;
      } else {
        va = stripAccents(va);
        vb = stripAccents(vb);
      }

      if (va < vb) return direction === 'asc' ? -1 : 1;
      if (va > vb) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    // Voltar para página 1 após ordenação
    paginationState.currentPage = 1;
    renderCurrentPage();
  }

  /**
   * Renderiza a página atual da tabela
   */
  function renderCurrentPage() {
    const table = document.querySelector('#partnershipHealthModule table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Limpar tbody
    tbody.innerHTML = '';

    // Filtrar linhas visíveis (baseado nos filtros de status e nome)
    const activeStatuses = getActiveStatuses();
    const dentistQuery = (document.getElementById('dentistSearchFilter')?.value || '')
      .trim().toLowerCase();

    const visibleRows = paginationState.allRows.filter(tr => {
      const statusOK = activeStatuses.includes(tr.dataset.status);
      const name = tr.querySelector('td a')?.textContent.toLowerCase() || '';
      const nameOK = !dentistQuery || name.includes(dentistQuery);
      return statusOK && nameOK;
    });

    // Calcular paginação
    const totalVisible = visibleRows.length;
    paginationState.totalPages = Math.ceil(totalVisible / PAGE_SIZE) || 1;

    // Ajustar página atual se necessário
    if (paginationState.currentPage > paginationState.totalPages) {
      paginationState.currentPage = Math.max(1, paginationState.totalPages);
    }

    // Obter linhas da página atual
    const startIdx = (paginationState.currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const pageRows = visibleRows.slice(startIdx, endIdx);

    // Adicionar linhas ao tbody
    pageRows.forEach(tr => {
      tr.style.display = '';
      tbody.appendChild(tr.cloneNode(true));
    });

    // Atualizar controles de paginação
    updatePaginationControls(totalVisible);
  }

  /**
   * Atualiza os controles de paginação
   */
  function updatePaginationControls(totalVisible) {
    const section = document.getElementById('partnershipHealthModule');
    if (!section) return;

    // Remover controles antigos
    const oldControls = section.querySelector('.pagination-controls');
    if (oldControls) oldControls.remove();

    const oldInfo = section.querySelector('.pagination-info');
    if (oldInfo) oldInfo.remove();

    // Não mostrar paginação se houver apenas 1 página
    if (paginationState.totalPages <= 1 && totalVisible <= PAGE_SIZE) {
      // Apenas mostrar info
      const info = document.createElement('div');
      info.className = 'pagination-info';
      info.style.marginTop = '10px';
      info.style.fontSize = '12px';
      info.style.color = '#666';
      info.textContent = `Mostrando ${totalVisible} dentista${totalVisible !== 1 ? 's' : ''}`;
      section.appendChild(info);
      return;
    }

    // Criar controles de paginação
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';
    controls.style.display = 'flex';
    controls.style.justifyContent = 'center';
    controls.style.gap = '5px';
    controls.style.marginTop = '15px';

    const borderColor = '#0066cc';

    // Botão anterior
    if (paginationState.currentPage > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '« Anterior';
      prevBtn.className = 'btn btn-sm';
      prevBtn.style.border = `1px solid ${borderColor}`;
      prevBtn.style.color = borderColor;
      prevBtn.addEventListener('click', () => {
        paginationState.currentPage--;
        renderCurrentPage();
      });
      controls.appendChild(prevBtn);
    }

    // Números de página
    let startPage = Math.max(1, paginationState.currentPage - 2);
    let endPage = Math.min(paginationState.totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.textContent = i;
      pageBtn.className = 'btn btn-sm';
      pageBtn.style.border = `1px solid ${borderColor}`;

      if (i === paginationState.currentPage) {
        pageBtn.style.backgroundColor = borderColor;
        pageBtn.style.color = '#fff';
      } else {
        pageBtn.style.color = borderColor;
        pageBtn.addEventListener('click', () => {
          paginationState.currentPage = i;
          renderCurrentPage();
        });
      }

      controls.appendChild(pageBtn);
    }

    // Botão próximo
    if (paginationState.currentPage < paginationState.totalPages) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Próximo »';
      nextBtn.className = 'btn btn-sm';
      nextBtn.style.border = `1px solid ${borderColor}`;
      nextBtn.style.color = borderColor;
      nextBtn.addEventListener('click', () => {
        paginationState.currentPage++;
        renderCurrentPage();
      });
      controls.appendChild(nextBtn);
    }

    section.appendChild(controls);

    // Info de paginação
    const startItem = (paginationState.currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(paginationState.currentPage * PAGE_SIZE, totalVisible);

    const info = document.createElement('div');
    info.className = 'pagination-info';
    info.style.marginTop = '10px';
    info.style.fontSize = '12px';
    info.style.color = '#666';
    info.style.textAlign = 'center';
    info.textContent = `Mostrando ${startItem}-${endItem} de ${totalVisible} dentistas (Página ${paginationState.currentPage} de ${paginationState.totalPages})`;
    section.appendChild(info);
  }

  /**
   * Formata gap (X meses e Y dias)
   */
  function formatGap(gapDays) {
    if (gapDays == null) return 'Histórico insuficiente';
    const months = Math.floor(gapDays / 30);
    const days = gapDays % 30;
    if (months > 0) {
      return days > 0
        ? `${months} mes${months > 1 ? 'es' : ''} e ${days} dia${days > 1 ? 's' : ''}`
        : `${months} mês${months > 1 ? 'es' : ''}`;
    } else {
      return `${days} dia${days > 1 ? 's' : ''}`;
    }
  }

  /**
   * Obtém bairros do dentista (máximo 2)
   */
  function getTwoNeighborhoods(dentist) {
    let neighborhoods = [];
    if (Array.isArray(dentist.dental_clinics)) {
      dentist.dental_clinics.forEach((clinic) => {
        if (clinic.neighborhood) {
          neighborhoods.push(clinic.neighborhood);
        }
      });
    }
    neighborhoods = neighborhoods.slice(0, 2);
    if (neighborhoods.length === 0) return "-";
    if (neighborhoods.length === 1) return neighborhoods[0];
    return `${neighborhoods[0]} / ${neighborhoods[1]}`;
  }

  // ========== CARREGAMENTO DO MÓDULO ==========

  /**
   * Carrega e renderiza toda a UI do módulo
   * Verifica se os dados já foram calculados hoje e usa cache se disponível
   */
  async function loadPartnershipHealthModule(year = new Date().getFullYear()) {
    console.log(`[CIROD Saúde] Carregando Saúde das Parcerias para o ano ${year}`);

    // Resetar estado de paginação
    paginationState = {
      currentPage: 1,
      totalPages: 1,
      allRows: []
    };

    const mainContent = document.querySelector('#content > div') || document.body;
    const section = document.createElement('section');
    section.id = 'partnershipHealthModule';
    section.style.margin = '20px';
    mainContent.appendChild(section);

    // Header com filtros
    renderPartnershipHealthHeader(section, year);

    // Criar tabela
    const table = createPartnershipHealthTable();

    // Wrapper com scroll
    const wrapper = document.createElement('div');
    wrapper.id = 'healthTableWrapper';
    wrapper.style.maxWidth = '100%';
    wrapper.style.margin = '0 auto 1rem';
    wrapper.style.overflowY = 'auto';
    wrapper.style.border = '1px solid #ddd';
    wrapper.style.borderRadius = '4px';
    wrapper.style.padding = '0.5rem';
    wrapper.style.maxHeight = '600px';
    wrapper.appendChild(table);

    // Overlay de carregamento com UX melhorada
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'healthLoadingOverlay';
    loadingOverlay.style.cssText = `
      padding: 40px 20px;
      text-align: center;
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e8eb 100%);
      border-radius: 8px;
      margin: 20px 0;
    `;

    const spinnerIcon = document.createElement('div');
    spinnerIcon.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size: 32px; color: #0066cc; margin-bottom: 15px;"></i>';
    loadingOverlay.appendChild(spinnerIcon);

    const loadingText = document.createElement('div');
    loadingText.id = 'healthLoadingText';
    loadingText.style.cssText = 'font-size: 16px; color: #333; font-weight: 500;';
    loadingText.textContent = 'Carregando dados de saúde das parcerias...';
    loadingOverlay.appendChild(loadingText);

    const loadingSubtext = document.createElement('div');
    loadingSubtext.id = 'healthLoadingSubtext';
    loadingSubtext.style.cssText = 'font-size: 12px; color: #666; margin-top: 8px;';
    loadingSubtext.textContent = 'Verificando última atualização...';
    loadingOverlay.appendChild(loadingSubtext);

    section.appendChild(loadingOverlay);
    section.appendChild(wrapper);
    wrapper.style.display = 'none'; // Esconder tabela durante carregamento

    // Aplicar ordenação inicial
    updateSortIcons();

    // Iniciar carregamento com verificação de cache
    await loadHealthDataWithCache(section, wrapper, loadingOverlay, year);
  }

  /**
   * Carrega dados de saúde das parcerias com verificação de cache diário
   * Se os dados não foram calculados hoje, executa o cálculo completo
   */
  async function loadHealthDataWithCache(section, wrapper, loadingOverlay, year) {
    const loadingText = document.getElementById('healthLoadingText');
    const loadingSubtext = document.getElementById('healthLoadingSubtext');
    const lastUpdateInfo = document.getElementById('healthLastUpdateInfo');

    try {
      // 1. Verificar se já existe cache para hoje
      if (loadingSubtext) loadingSubtext.textContent = 'Verificando última atualização...';

      const configResponse = await sendServiceMessage({ command: 'getHealthConfig' });
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      let needsRecalc = true;
      let lastCalcDate = null;
      let lastCalcTime = null;
      let cachedData = null;

      if (configResponse.status === 'success' && configResponse.data) {
        lastCalcDate = configResponse.data.lastHealthCalculation;
        lastCalcTime = configResponse.data.lastHealthCalculationTime;
        cachedData = configResponse.data.healthData;

        // Verificar se o cache é do mesmo ano solicitado
        const cacheYear = configResponse.data.cacheYear;

        if (lastCalcDate === today && cacheYear === year && cachedData && cachedData.length > 0) {
          needsRecalc = false;
          console.log('[CIROD Saúde] Dados já calculados hoje, usando cache:', lastCalcDate);
        } else {
          console.log('[CIROD Saúde] Cache desatualizado ou ano diferente. Último cálculo:', lastCalcDate || 'nunca');
        }
      } else {
        console.log('[CIROD Saúde] Configuração não encontrada, primeiro acesso');
      }

      // 2. Se tem cache válido, usar os dados
      if (!needsRecalc && cachedData) {
        if (loadingText) loadingText.textContent = 'Carregando dados do cache...';
        if (loadingSubtext) loadingSubtext.textContent = 'Dados já calculados hoje, carregando rapidamente...';

        // Reconstruir as linhas a partir do cache
        cachedData.forEach(item => {
          const dentist = {
            id: item.dentistId,
            name: item.dentistName,
            areasDisplay: item.areasDisplay
          };
          const metrics = {
            freqCurrent: item.freqCurrent,
            gapDays: item.gapDays,
            bestHistory: item.bestHistory,
            percentPotential: item.percentPotential,
            scoreChurn: item.scoreChurn,
            confidence: item.confidence,
            status: item.status
          };
          const row = buildPartnershipHealthRow(dentist, metrics);
          paginationState.allRows.push(row);
        });

        // Atualizar info de última atualização
        if (lastUpdateInfo && lastCalcDate && lastCalcTime) {
          const displayDate = formatDateBR(lastCalcDate);
          lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate} às ${lastCalcTime}`;
        }

        // Remover overlay e mostrar tabela
        loadingOverlay.remove();
        wrapper.style.display = '';
        applySorting();

        // Mostrar botão de recálculo manual
        const recalcButton = document.getElementById('healthRecalcButton');
        if (recalcButton) {
          recalcButton.style.display = '';
        }

        console.log(`[CIROD Saúde] Dados carregados do cache: ${paginationState.allRows.length} dentistas`);
        return;
      }

      // 3. Precisa recalcular - mostrar progresso
      if (loadingText) loadingText.textContent = 'Calculando saúde das parcerias...';
      if (loadingSubtext) {
        loadingSubtext.textContent = 'Primeira atualização do dia, analisando dados...';
      }

      // Intervalo de datas para o ano selecionado
      const start = new Date(`${year}-01-01T00:00:00Z`).toISOString();
      const end = year === new Date().getFullYear()
        ? new Date().toISOString()
        : new Date(`${year + 1}-01-01T00:00:00Z`).toISOString();

      // Carregar dentistas do DynamoDB
      const rawDentists = await queryDentistsForHealth();
      console.log(`[CIROD Saúde] Dentistas carregados: ${rawDentists.length}`);

      // Mapear dados dos dentistas
      const dentists = rawDentists
        .map(d => ({
          id: d.dentist_id ?? d.id,
          cro: d.dentist_cro,
          name: d.dentist_name ?? d.name,
          areasDisplay: getTwoNeighborhoods(d)
        }))
        .filter(d => d.id);

      console.log(`[CIROD Saúde] Dentistas válidos para análise: ${dentists.length}`);

      // Array para guardar dados do cache
      const healthDataForCache = [];

      // Para cada dentista, buscar datas das requisições
      let processedCount = 0;

      for (let i = 0; i < dentists.length; i += CONCURRENCY) {
        const batch = dentists.slice(i, i + CONCURRENCY);

        await Promise.all(batch.map(async dentist => {
          const dates = await queryDentistRequestsInRange(dentist.id, dentist.cro, start, end);
          processedCount++;

          if (loadingSubtext) {
            loadingSubtext.textContent = `Analisando dentistas... (${processedCount}/${dentists.length})`;
          }

          if (!dates.length) return;

          const metrics = computePartnershipMetricsFromDates(dates);
          const row = buildPartnershipHealthRow(dentist, metrics);
          paginationState.allRows.push(row);

          // Guardar para cache
          healthDataForCache.push({
            dentistId: dentist.id,
            dentistName: dentist.name,
            areasDisplay: dentist.areasDisplay,
            freqCurrent: metrics.freqCurrent,
            gapDays: metrics.gapDays,
            bestHistory: metrics.bestHistory,
            percentPotential: metrics.percentPotential,
            scoreChurn: metrics.scoreChurn,
            confidence: metrics.confidence,
            status: metrics.status
          });
        }));

        // Renderizar página atual após cada batch (mostra progresso)
        wrapper.style.display = '';
        applySorting();
      }

      // 4. Salvar cache no DynamoDB
      const now = new Date();
      lastCalcDate = today;
      lastCalcTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      await sendServiceMessage({
        command: 'setHealthConfig',
        data: {
          lastHealthCalculation: today,
          lastHealthCalculationTime: lastCalcTime,
          cacheYear: year,
          healthData: healthDataForCache
        }
      });

      console.log('[CIROD Saúde] Cache salvo no DynamoDB');

      // 5. Atualizar info de última atualização
      if (lastUpdateInfo) {
        const displayDate = formatDateBR(lastCalcDate);
        lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate} às ${lastCalcTime}`;
      }

      // Remover overlay
      loadingOverlay.remove();

      // Mostrar botão de recálculo manual
      const recalcButton = document.getElementById('healthRecalcButton');
      if (recalcButton) {
        recalcButton.style.display = '';
      }

      console.log(`[CIROD Saúde] Carregamento concluído. ${paginationState.allRows.length} dentistas com dados.`);

    } catch (err) {
      console.error('[CIROD Saúde] Erro ao carregar:', err);

      if (loadingOverlay) {
        loadingOverlay.innerHTML = `
          <div style="color: #dc3545; margin-bottom: 10px;">
            <i class="fa fa-exclamation-triangle" style="font-size: 32px;"></i>
          </div>
          <div style="font-size: 16px; color: #333; font-weight: 500;">Erro ao carregar dados</div>
          <div style="font-size: 12px; color: #666; margin-top: 8px;">${err.message || 'Erro desconhecido'}</div>
          <button onclick="location.reload()" class="btn btn-sm btn-outline-primary" style="margin-top: 15px;">
            <i class="fa fa-refresh"></i> Tentar novamente
          </button>
        `;
      }

      if (lastUpdateInfo) {
        lastUpdateInfo.innerHTML = '<i class="fa fa-exclamation-circle" style="color: #dc3545;"></i> Erro ao verificar atualização';
      }
    }
  }

  /**
   * Formata data no padrão brasileiro (DD/MM/YYYY)
   */
  function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  /**
   * Handler para recálculo manual da análise de saúde
   * Permite ao usuário forçar um recálculo mesmo que já tenha sido feito hoje
   */
  async function handleManualHealthRecalc(year) {
    const recalcButton = document.getElementById('healthRecalcButton');
    const lastUpdateInfo = document.getElementById('healthLastUpdateInfo');

    if (!recalcButton) return;

    // Confirmar ação
    if (!confirm('Deseja recalcular a análise de saúde das parcerias?\nIsso pode demorar alguns segundos.')) {
      return;
    }

    // Desabilitar botão e mostrar loading
    recalcButton.disabled = true;
    recalcButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    recalcButton.title = 'Recalculando...';

    if (lastUpdateInfo) {
      lastUpdateInfo.innerHTML = '<i class="fa fa-sync fa-spin" style="color: #0066cc;"></i> Recalculando análise...';
    }

    try {
      // Limpar módulo e recarregar forçando recálculo
      clearPartnershipHealthModule();

      // Resetar estado de paginação
      paginationState = {
        currentPage: 1,
        totalPages: 1,
        allRows: []
      };

      const mainContent = document.querySelector('#content > div') || document.body;
      const section = document.createElement('section');
      section.id = 'partnershipHealthModule';
      section.style.margin = '20px';
      mainContent.appendChild(section);

      // Header com filtros
      renderPartnershipHealthHeader(section, year);

      // Criar tabela
      const table = createPartnershipHealthTable();

      // Wrapper com scroll
      const wrapper = document.createElement('div');
      wrapper.id = 'healthTableWrapper';
      wrapper.style.maxWidth = '100%';
      wrapper.style.margin = '0 auto 1rem';
      wrapper.style.overflowY = 'auto';
      wrapper.style.border = '1px solid #ddd';
      wrapper.style.borderRadius = '4px';
      wrapper.style.padding = '0.5rem';
      wrapper.style.maxHeight = '600px';
      wrapper.appendChild(table);
      section.appendChild(wrapper);

      // Atualizar referências após recriar UI
      const newRecalcButton = document.getElementById('healthRecalcButton');
      const newLastUpdateInfo = document.getElementById('healthLastUpdateInfo');

      if (newRecalcButton) {
        newRecalcButton.disabled = true;
        newRecalcButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      }

      if (newLastUpdateInfo) {
        newLastUpdateInfo.innerHTML = '<i class="fa fa-sync fa-spin" style="color: #0066cc;"></i> Recalculando análise...';
      }

      // Aplicar ordenação inicial
      updateSortIcons();

      // Forçar recálculo (não usar cache)
      await loadHealthDataForceRecalc(section, wrapper, year);

      console.log('[CIROD Saúde] Recálculo manual concluído');
    } catch (error) {
      console.error('[CIROD Saúde] Erro no recálculo manual:', error);
      alert('Erro ao recalcular análise: ' + error.message);

      if (lastUpdateInfo) {
        lastUpdateInfo.innerHTML = '<i class="fa fa-exclamation-circle" style="color: #dc3545;"></i> Erro no recálculo';
      }
    }
  }

  /**
   * Carrega dados forçando recálculo (ignora cache)
   */
  async function loadHealthDataForceRecalc(section, wrapper, year) {
    const loadingSubtext = document.getElementById('healthLoadingSubtext');
    const lastUpdateInfo = document.getElementById('healthLastUpdateInfo');

    try {
      // Intervalo de datas para o ano selecionado
      const start = new Date(`${year}-01-01T00:00:00Z`).toISOString();
      const end = year === new Date().getFullYear()
        ? new Date().toISOString()
        : new Date(`${year + 1}-01-01T00:00:00Z`).toISOString();

      // Carregar dentistas do DynamoDB
      const rawDentists = await queryDentistsForHealth();
      console.log(`[CIROD Saúde] Dentistas carregados: ${rawDentists.length}`);

      // Mapear dados dos dentistas
      const dentists = rawDentists
        .map(d => ({
          id: d.dentist_id ?? d.id,
          cro: d.dentist_cro,
          name: d.dentist_name ?? d.name,
          areasDisplay: getTwoNeighborhoods(d)
        }))
        .filter(d => d.id);

      console.log(`[CIROD Saúde] Dentistas válidos para análise: ${dentists.length}`);

      // Array para guardar dados do cache
      const healthDataForCache = [];

      // Para cada dentista, buscar datas das requisições
      let processedCount = 0;

      // Mostrar spinner de progresso
      const spinner = document.createElement('div');
      spinner.id = 'healthSpinner';
      spinner.style.padding = '10px';
      spinner.style.textAlign = 'center';
      spinner.style.color = '#666';
      spinner.textContent = `Analisando dentistas... (0/${dentists.length})`;
      section.insertBefore(spinner, wrapper);

      for (let i = 0; i < dentists.length; i += CONCURRENCY) {
        const batch = dentists.slice(i, i + CONCURRENCY);

        await Promise.all(batch.map(async dentist => {
          const dates = await queryDentistRequestsInRange(dentist.id, dentist.cro, start, end);
          processedCount++;

          spinner.textContent = `Analisando dentistas... (${processedCount}/${dentists.length})`;

          if (!dates.length) return;

          const metrics = computePartnershipMetricsFromDates(dates);
          const row = buildPartnershipHealthRow(dentist, metrics);
          paginationState.allRows.push(row);

          // Guardar para cache
          healthDataForCache.push({
            dentistId: dentist.id,
            dentistName: dentist.name,
            areasDisplay: dentist.areasDisplay,
            freqCurrent: metrics.freqCurrent,
            gapDays: metrics.gapDays,
            bestHistory: metrics.bestHistory,
            percentPotential: metrics.percentPotential,
            scoreChurn: metrics.scoreChurn,
            confidence: metrics.confidence,
            status: metrics.status
          });
        }));

        // Renderizar página atual após cada batch
        applySorting();
      }

      spinner.remove();

      // Salvar cache no DynamoDB
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const lastCalcTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      await sendServiceMessage({
        command: 'setHealthConfig',
        data: {
          lastHealthCalculation: today,
          lastHealthCalculationTime: lastCalcTime,
          cacheYear: year,
          healthData: healthDataForCache
        }
      });

      console.log('[CIROD Saúde] Cache atualizado no DynamoDB');

      // Atualizar info de última atualização
      if (lastUpdateInfo) {
        const displayDate = formatDateBR(today);
        lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate} às ${lastCalcTime}`;
      }

      // Mostrar botão de recálculo
      const recalcButton = document.getElementById('healthRecalcButton');
      if (recalcButton) {
        recalcButton.disabled = false;
        recalcButton.innerHTML = '<i class="fa fa-refresh"></i>';
        recalcButton.title = 'Recalcular análise de saúde manualmente';
        recalcButton.style.display = '';
      }

      console.log(`[CIROD Saúde] Recálculo concluído. ${paginationState.allRows.length} dentistas com dados.`);

    } catch (err) {
      console.error('[CIROD Saúde] Erro no recálculo forçado:', err);
      throw err;
    }
  }

  /**
   * Consulta dentistas do DynamoDB
   */
  function queryDentistsForHealth() {
    return sendServiceMessage({ command: 'scanDentistsKPIs' })
      .then(response => {
        if (response.status === 'cancelled') {
          return [];
        }
        return response.data || [];
      })
      .catch(error => {
        console.error('[CIROD Saúde] Erro ao consultar dentistas:', error);
        return [];
      });
  }

  /**
   * Consulta datas das requisições de um dentista no período
   * Usa dentist_id como identificador principal, CRO como fallback
   */
  function queryDentistRequestsInRange(dentistId, dentistCro, since, until) {
    return sendServiceMessage({
      command: 'queryDentistRequestDates',
      dentistId: dentistId,
      dentistCro: dentistCro,
      since: since,
      until: until
    })
    .then(response => {
      if (response.status === 'success') {
        return response.data || [];
      }
      return [];
    })
    .catch(error => {
      console.error(`[CIROD Saúde] Erro ao consultar requisições do dentista ${dentistId}:`, error);
      return [];
    });
  }

  // ========== CÁLCULO DE MÉTRICAS ==========

  /**
   * Computa métricas a partir de array de datas ISO
   */
  function computePartnershipMetricsFromDates(dates) {
    const dd = dates
      .map(str => { const dt = new Date(str); return isNaN(dt) ? null : dt; })
      .filter(d => d instanceof Date)
      .sort((a, b) => a - b);

    const gapDays = dd.length
      ? Math.floor((Date.now() - dd[dd.length - 1].getTime()) / 86400000)
      : null;

    // 1) Inativa (> 60 dias sem indicação)
    if (gapDays > 60) {
      return {
        freqCurrent: null,
        gapDays,
        bestHistory: null,
        percentPotential: null,
        scoreChurn: null,
        confidence: 'Baixa',
        status: 'Inativa'
      };
    }

    // 2) Histórico curto (menos de 3 eventos)
    if (dd.length < 3) {
      // Oportunidade: nunca indicou ou indicou há até 20 dias
      if (dd.length === 0 || gapDays <= 20) {
        return {
          freqCurrent: null,
          gapDays,
          bestHistory: null,
          percentPotential: null,
          scoreChurn: null,
          confidence: 'Baixa',
          status: 'Oportunidade'
        };
      }
      // Atenção: poucos eventos e gap entre 21 e 60 dias
      return {
        freqCurrent: null,
        gapDays,
        bestHistory: null,
        percentPotential: null,
        scoreChurn: null,
        confidence: 'Baixa',
        status: 'Atenção'
      };
    }

    // 3) Calcular intervalos entre eventos + gap
    const intervals = [];
    for (let i = 1; i < dd.length; i++) {
      intervals.push((dd[i].getTime() - dd[i - 1].getTime()) / 86400000);
    }
    intervals.push(gapDays);

    // 4) EWMA (Exponentially Weighted Moving Average)
    const alpha = 0.3;
    let ewma = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      ewma = alpha * intervals[i] + (1 - alpha) * ewma;
    }
    const freqCurrent = ewma;

    // 5) Melhor histórico em qualquer janela de 60 dias
    let bestHistory = freqCurrent;
    for (let i = 0; i < dd.length; i++) {
      const window = dd.filter(d => d.getTime() - dd[i].getTime() <= 60 * 86400000);
      if (window.length > 1) {
        const wi = window.slice(1).map((d, j) =>
          (d.getTime() - window[j].getTime()) / 86400000
        );
        const avg = wi.reduce((a, b) => a + b, 0) / wi.length;
        if (avg < bestHistory) bestHistory = avg;
      }
    }

    // 6) Outras métricas
    const percentPotential = (freqCurrent / bestHistory) * 100;
    const confidence = dd.length <= 5 ? 'Média' : 'Alta';
    const gapRel = Math.min(gapDays / (freqCurrent * 1.8), 1);
    const quedaRel = percentPotential >= 100 ? 0 : (100 - percentPotential) / 100;
    const peso = confidence === 'Alta' ? 1 : confidence === 'Média' ? 0.75 : 0.5;
    const rawScore = ((gapRel + quedaRel) / 2) * peso;
    const scoreChurn = Math.round(rawScore * 100);

    // 7) Tendência via EWMA "anterior"
    let ewmaPrev = intervals[0];
    for (let i = 1; i < intervals.length - 1; i++) {
      ewmaPrev = alpha * intervals[i] + (1 - alpha) * ewmaPrev;
    }
    const trend = (freqCurrent - ewmaPrev) / ewmaPrev;

    // 8) Volume nos últimos 30 dias
    const now = Date.now();
    const cutoff30 = new Date(now - 30 * 86400000);
    const countLast30 = dd.filter(d => d.getTime() >= cutoff30.getTime()).length;
    const rateLast30 = countLast30 / 30;
    const rateCurrent = freqCurrent ? 1 / freqCurrent : 0;

    // 9) Status final
    let status;
    if (rateLast30 > rateCurrent * 1.3) {
      status = 'Acelerando';
    } else if (gapDays > 60) {
      status = 'Inativa';
    } else if (trend >= 0.2 && gapDays >= 15) {
      status = 'Queda';
    } else if (trend >= 0.1) {
      status = 'Atenção';
    } else {
      status = 'Estável';
    }

    return {
      freqCurrent,
      gapDays,
      bestHistory,
      percentPotential,
      scoreChurn,
      confidence,
      status
    };
  }

  // ========== RENDERIZAÇÃO ==========

  /**
   * Renderiza header com filtros
   */
  function renderPartnershipHealthHeader(section, currentYear) {
    // Wrapper do cabeçalho com título e info de atualização
    const headerWrapper = document.createElement('div');
    headerWrapper.style.display = 'flex';
    headerWrapper.style.justifyContent = 'space-between';
    headerWrapper.style.alignItems = 'center';
    headerWrapper.style.marginBottom = '20px';


    // Container para info de atualização e botão de recálculo
    const updateContainer = document.createElement('div');
    updateContainer.style.display = 'flex';
    updateContainer.style.alignItems = 'center';
    updateContainer.style.gap = '12px';

    // Info de última atualização
    const lastUpdateInfo = document.createElement('div');
    lastUpdateInfo.id = 'healthLastUpdateInfo';
    lastUpdateInfo.style.fontSize = '12px';
    lastUpdateInfo.style.color = '#666';
    lastUpdateInfo.style.textAlign = 'right';
    lastUpdateInfo.innerHTML = '<i class="fa fa-clock"></i> Verificando última atualização...';
    updateContainer.appendChild(lastUpdateInfo);

    // Botão de recálculo manual
    const recalcButton = document.createElement('button');
    recalcButton.id = 'healthRecalcButton';
    recalcButton.className = 'btn btn-sm btn-outline-secondary';
    recalcButton.innerHTML = '<i class="fa fa-refresh"></i>';
    recalcButton.title = 'Recalcular análise de saúde manualmente';
    recalcButton.style.padding = '4px 8px';
    recalcButton.style.fontSize = '12px';
    recalcButton.style.display = 'none'; // Escondido até carregar
    recalcButton.addEventListener('click', () => handleManualHealthRecalc(currentYear));
    updateContainer.appendChild(recalcButton);

    headerWrapper.appendChild(updateContainer);

    section.appendChild(headerWrapper);

    // Row de filtros
    const row = document.createElement('div');
    row.className = 'row g-3 mb-3';

    // a) Filtro de status (botões)
    const colStatus = document.createElement('div');
    colStatus.className = 'col-md-5';

    const labelStatus = document.createElement('label');
    labelStatus.textContent = 'Status da Parceria';
    labelStatus.style.fontWeight = 'bold';
    labelStatus.style.marginBottom = '8px';
    labelStatus.style.display = 'block';
    colStatus.appendChild(labelStatus);

    const legendWrapper = document.createElement('div');
    legendWrapper.style.display = 'flex';
    legendWrapper.style.flexWrap = 'wrap';
    legendWrapper.style.gap = '4px';

    const statuses = [
      { key: 'Acelerando', label: 'Acelerando', color: '#198754', active: true },
      { key: 'Estável', label: 'Estável', color: '#66CC66', active: true },
      { key: 'Oportunidade', label: 'Oportunidade', color: '#007BFF', active: true },
      { key: 'Atenção', label: 'Atenção', color: '#FFCC00', active: true },
      { key: 'Queda', label: 'Queda', color: '#CC3333', active: true },
      { key: 'Inativa', label: 'Inativa', color: '#888888', active: false }
    ];

    statuses.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.textContent = s.label;
      btn.dataset.status = s.key;
      btn.style.backgroundColor = s.color;
      btn.style.color = '#fff';
      btn.style.opacity = s.active ? '1' : '0.5';
      btn.style.border = 'none';
      btn.style.padding = '4px 8px';
      btn.style.fontSize = '12px';
      if (s.active) btn.classList.add('active');

      btn.addEventListener('click', () => {
        const isActive = btn.classList.toggle('active');
        btn.style.opacity = isActive ? '1' : '0.5';
        applyStatusFilter();
      });
      legendWrapper.appendChild(btn);
    });
    colStatus.appendChild(legendWrapper);
    row.appendChild(colStatus);

    // b) Filtro por dentista (input text)
    const colDentist = document.createElement('div');
    colDentist.className = 'col-md-4';

    const labelDentist = document.createElement('label');
    labelDentist.setAttribute('for', 'dentistSearchFilter');
    labelDentist.textContent = 'Nome do Dentista';
    labelDentist.style.fontWeight = 'bold';
    labelDentist.style.marginBottom = '8px';
    labelDentist.style.display = 'block';
    colDentist.appendChild(labelDentist);

    const dentistFilter = document.createElement('input');
    dentistFilter.type = 'text';
    dentistFilter.id = 'dentistSearchFilter';
    dentistFilter.className = 'form-control';
    dentistFilter.placeholder = 'Digite o nome do dentista';
    dentistFilter.addEventListener('input', () => applyStatusFilter());
    colDentist.appendChild(dentistFilter);
    row.appendChild(colDentist);

    // c) Filtro por ano (select)
    const colYear = document.createElement('div');
    colYear.className = 'col-md-3';

    const labelYear = document.createElement('label');
    labelYear.setAttribute('for', 'yearFilter');
    labelYear.textContent = 'Ano de Análise';
    labelYear.style.fontWeight = 'bold';
    labelYear.style.marginBottom = '8px';
    labelYear.style.display = 'block';
    colYear.appendChild(labelYear);

    const selectYear = document.createElement('select');
    selectYear.id = 'yearFilter';
    selectYear.className = 'form-select';
    const curYear = new Date().getFullYear();
    for (let y = curYear; y >= 2020; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === currentYear) opt.selected = true;
      selectYear.appendChild(opt);
    }
    selectYear.addEventListener('change', () => {
      sortState = { colIndex: 2, direction: 'asc' };
      clearPartnershipHealthModule();
      loadPartnershipHealthModule(parseInt(selectYear.value, 10));
    });
    colYear.appendChild(selectYear);
    row.appendChild(colYear);

    section.appendChild(row);
  }

  /**
   * Cria a tabela com cabeçalhos ordenáveis
   */
  function createPartnershipHealthTable() {
    const table = document.createElement('table');
    table.className = 'table table-sm table-striped table-bordered table-hover';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Dentista</th>
        <th>Bairros</th>
        <th>Frequência atual</th>
        <th>Tempo desde último paciente</th>
        <th>Saúde da parceria</th>
      </tr>`;
    table.appendChild(thead);

    // Colunas ordenáveis
    const headers = thead.querySelectorAll('th');
    const sortable = [
      { idx: 0, type: 'string' },  // Dentista
      { idx: 2, type: 'number' },  // Frequência
      { idx: 3, type: 'number' },  // Tempo desde último
      { idx: 4, type: 'string' }   // Status
    ];

    sortable.forEach(({ idx, type }) => {
      const th = headers[idx];
      th.classList.add('sortable');
      th.style.cursor = 'pointer';
      th.style.whiteSpace = 'nowrap';
      th.innerHTML += ' <span class="sort-icon"></span>';

      const icon = th.querySelector('.sort-icon');
      icon.style.verticalAlign = 'middle';
      icon.style.marginLeft = '4px';
      icon.style.fontSize = '10px';

      th.dataset.type = type;
      th.dataset.index = idx;

      if (idx === sortState.colIndex) {
        // Coluna ativa: mostrar direção atual com opacidade total
        th.classList.add('sorted');
        icon.style.opacity = '1';
        icon.innerHTML = sortState.direction === 'asc'
          ? '<i class="fa fa-sort-up"></i>'
          : '<i class="fa fa-sort-down"></i>';
      } else {
        // Coluna inativa: mostrar ícone neutro indicando que é ordenável
        icon.style.opacity = '0.4';
        icon.innerHTML = '<i class="fa fa-sort"></i>';
      }

      // Hover effect
      th.addEventListener('mouseenter', () => {
        th.style.backgroundColor = 'rgba(0,0,0,0.05)';
      });
      th.addEventListener('mouseleave', () => {
        th.style.backgroundColor = '';
      });

      th.addEventListener('click', () => onHeaderClick(th));
    });

    // Sticky header
    thead.style.position = 'sticky';
    thead.style.top = '0';
    thead.style.backgroundColor = '#fff';
    thead.style.zIndex = '1';
    thead.style.boxShadow = '0 2px 2px -1px rgba(0,0,0,0.4)';

    table.appendChild(document.createElement('tbody'));
    return table;
  }

  /**
   * Constrói uma linha da tabela
   */
  function buildPartnershipHealthRow(dentist, m) {
    const tr = document.createElement('tr');
    tr.dataset.status = m.status;

    // 1) Nome + link
    const td1 = document.createElement('td');
    const lk = document.createElement('a');
    lk.href = `https://max.cfaz.net/usr/dentist_data/${dentist.id}`;
    lk.target = '_blank';
    lk.textContent = dentist.name || 'Sem nome';
    lk.style.textDecoration = 'none';
    td1.appendChild(lk);
    tr.appendChild(td1);

    // 2) Bairros
    const td2 = document.createElement('td');
    td2.textContent = dentist.areasDisplay;
    tr.appendChild(td2);

    // 3) Frequência
    const td3 = document.createElement('td');
    td3.textContent = m.freqCurrent != null
      ? `${Math.round(m.freqCurrent)} dias`
      : '-';
    tr.appendChild(td3);

    // 4) Gap
    const td4 = document.createElement('td');
    td4.textContent = formatGap(m.gapDays);
    tr.appendChild(td4);

    // 5) Status com cor
    const td5 = document.createElement('td');
    td5.textContent = m.status;
    td5.style.fontWeight = 'bold';
    td5.style.textAlign = 'center';
    td5.style.borderRadius = '4px';

    const statusColors = {
      'Acelerando': '#198754',
      'Estável': '#66CC66',
      'Oportunidade': '#007BFF',
      'Atenção': '#FFCC00',
      'Queda': '#CC3333',
      'Inativa': '#888888'
    };
    td5.style.backgroundColor = statusColors[m.status] || 'transparent';
    td5.style.color = '#fff';
    tr.appendChild(td5);

    return tr;
  }

  /**
   * Retorna array dos status ativos (botões com classe 'active')
   */
  function getActiveStatuses() {
    return Array.from(
      document.querySelectorAll('#partnershipHealthModule button[data-status].active')
    ).map(btn => btn.dataset.status);
  }

  /**
   * Aplica filtros de status e nome - volta para página 1 e re-renderiza
   */
  function applyStatusFilter() {
    paginationState.currentPage = 1;
    renderCurrentPage();
  }

  // ========== EXPORTS ==========
  window.initPartnershipHealthModule = initPartnershipHealthModule;

  // Inicializar quando o DOM estiver pronto
  document.addEventListener('turbo:load', initPartnershipHealthModule);
})();
