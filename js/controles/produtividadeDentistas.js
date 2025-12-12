/**
 * produtividadeDentistas.js - Assistente CIROD
 * Página de controle de produtividade dos dentistas
 * Com 14 abas: Geral + 13 unidades CIROD
 *
 * Chart.js é carregado automaticamente via manifest.json como content script
 * (mesmo padrão do Auto-X), garantindo disponibilidade global de window.Chart
 */

(function () {
  // Verificar se Chart.js está disponível (carregado via manifest.json)
  function ensureChartJS() {
    return new Promise((resolve) => {
      if (window.Chart) {
        console.log('[CIROD] Chart.js disponível');
        resolve(true);
        return;
      }

      // Chart.js deveria estar carregado via manifest - aguardar um pouco
      console.warn('[CIROD] Chart.js não encontrado, aguardando...');
      let attempts = 0;
      const maxAttempts = 10;

      const checkInterval = setInterval(() => {
        attempts++;
        if (window.Chart) {
          clearInterval(checkInterval);
          console.log('[CIROD] Chart.js encontrado após ' + attempts + ' tentativas');
          resolve(true);
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          console.error('[CIROD] Chart.js não disponível após ' + maxAttempts + ' tentativas. Verifique o manifest.json.');
          resolve(false);
        }
      }, 100);
    });
  }

  // Usar CIROD_UNITS do awsConfig.js (carregado antes via manifest.json)
  // Ordenação específica para exibição nas abas:
  // 1. Geral (sempre primeiro)
  // 2. Unidades habilitadas (com ID do Cfaz confirmado)
  // 3. Unidades desabilitadas (ID ainda não mapeado) - em ordem alfabética
  const CIROD_UNITS_UI = typeof CIROD_UNITS !== 'undefined' ? [
    // Geral sempre primeiro
    CIROD_UNITS.find(u => u.id === 0),
    // Unidades habilitadas (IDs do Cfaz confirmados)
    ...CIROD_UNITS.filter(u => u.id !== 0 && u.enabled === true),
    // Unidades desabilitadas (ainda não mapeadas)
    ...CIROD_UNITS.filter(u => u.enabled === false).sort((a, b) => a.name.localeCompare(b.name))
  ].filter(Boolean) : [];

  let productivityDentists = [];
  let currentPage = 1;
  const pageSize = 50;

  let currentMode = 0; // 0 = Geral
  let currentSort = { column: null, direction: "asc" };

  const { lastMonthYear, lastMonth, penultMonthYear, penultMonth } = getLastTwoConcludedMonths();

  // Senhas de acesso - usar ACCESS_PASSWORDS do awsConfig.js (carregado antes via manifest.json)

  /**
   * Inicialização do módulo
   */
  function initDentistProductivityModule() {
    // Verificar se já existe o item de produtividade no dropdown
    const existingItem = document.querySelector("a.dropdown-item[href='#dentist_productivity']");
    if (existingItem) {
      console.log("[CIROD] Item Produtividade já existe no menu.");
      return;
    }

    console.log("[CIROD] Inicializando módulo Produtividade...");

    // Usar setTimeout para garantir que o DOM está pronto
    setTimeout(() => {
      createDentistProductivityDropdownItem();
    }, 100);
  }

  /**
   * Cria o menu dropdown "Controles" no navbar
   * Baseado EXATAMENTE no padrão do RadX (deliveryControlSection.js linha 873-916)
   */
  function createControlsDropdown() {
    const navbar = document.getElementById("navbarText");
    if (!navbar) {
      console.error("[CIROD] Navbar não encontrado");
      return null;
    }

    // Verificar se já existe um menu Controles
    const existingDropdowns = navbar.querySelectorAll(".nav-item.dropdown");
    for (const dropdown of existingDropdowns) {
      const pText = dropdown.querySelector("p");
      if (pText && pText.textContent.trim() === "Controles") {
        console.log("[CIROD] Menu 'Controles' já existe");
        return dropdown;
      }
    }

    console.log("[CIROD] Criando menu 'Controles'...");

    // Criar estrutura EXATAMENTE igual ao RadX
    const li = document.createElement("li");
    li.className = "nav-item dropdown";

    const aToggle = document.createElement("a");
    aToggle.className = "nav-link d-flex justify-content-between align-items-center ps-3 mb-2";
    aToggle.href = "#";
    aToggle.setAttribute("role", "button");
    aToggle.setAttribute("data-bs-toggle", "dropdown");
    aToggle.setAttribute("aria-expanded", "false");

    const divContent = document.createElement("div");
    divContent.className = "d-flex align-items-end";

    const icon = document.createElement("i");
    icon.className = "fa-light fa-tasks me-3";

    const pTitle = document.createElement("p");
    pTitle.className = "text-light-emphasis m-0";
    pTitle.textContent = "Controles";

    divContent.appendChild(icon);
    divContent.appendChild(pTitle);
    aToggle.appendChild(divContent);

    const chevron = document.createElement("i");
    chevron.className = "fa-light fa-chevron-down";
    aToggle.appendChild(chevron);

    li.appendChild(aToggle);

    const dropdownMenu = document.createElement("ul");
    dropdownMenu.className = "dropdown-menu rounded-0";
    li.appendChild(dropdownMenu);

    navbar.appendChild(li);
    console.log("[CIROD] Menu 'Controles' criado com sucesso");

    return li;
  }

  /**
   * Adiciona o item "Produtividade dos Dentistas" ao menu "Controles"
   * Baseado no padrão do RadX (deliveryControlSection.js)
   */
  function createDentistProductivityDropdownItem() {
    console.log("[CIROD Produtividade] Iniciando criação do item de menu...");

    // Criar ou obter o menu Controles
    const controlsLi = createControlsDropdown();
    if (!controlsLi) {
      console.error("[CIROD Produtividade] Não foi possível criar/obter menu 'Controles'");
      return;
    }

    const dropdownMenu = controlsLi.querySelector(".dropdown-menu");
    if (!dropdownMenu) {
      console.error("[CIROD Produtividade] Dropdown menu não encontrado");
      return;
    }

    // Verificar se já existe
    const existingItem = dropdownMenu.querySelector("a.dropdown-item[href='#dentist_productivity']");
    if (existingItem) {
      console.log("[CIROD Produtividade] Item já existe");
      return;
    }

    // Criar o item (mesmo padrão do RadX)
    const liProdutividade = document.createElement("li");
    const aProdutividade = document.createElement("a");
    aProdutividade.className = "dropdown-item";
    aProdutividade.href = "#dentist_productivity";
    aProdutividade.textContent = "Produtividade dos Dentistas";
    liProdutividade.appendChild(aProdutividade);
    dropdownMenu.appendChild(liProdutividade);

    console.log("[CIROD Produtividade] Item adicionado ao menu 'Controles'");

    aProdutividade.addEventListener("click", function (e) {
      e.preventDefault();
      console.log("[CIROD Produtividade] Item clicado");

      const pass = prompt("Digite a senha de acesso:");
      if (!ACCESS_PASSWORDS.includes(pass)) {
        alert("Senha incorreta!");
        return;
      }

      if (typeof hideMainContent === "function") {
        hideMainContent();
      }
      loadDentistProductivityModule();
    });
  }

  /**
   * Carrega o módulo de produtividade
   * IMPORTANTE: Esta função só é chamada após o usuário digitar a senha correta
   */
  function loadDentistProductivityModule() {
    // Chart.js já está carregado via manifest.json - apenas verificar
    ensureChartJS();

    let container = document.getElementById("dentistProductivityModule");
    if (!container) {
      const mainContent = document.querySelector("#content > div");
      container = document.createElement("div");
      container.id = "dentistProductivityModule";
      container.style.margin = "20px";
      mainContent.appendChild(container);
    } else {
      container.style.display = "block";
    }

    container.innerHTML = "";

    // Cabeçalho com título e info de última atualização
    const headerWrapper = document.createElement("div");
    headerWrapper.style.display = "flex";
    headerWrapper.style.justifyContent = "space-between";
    headerWrapper.style.alignItems = "center";
    headerWrapper.style.marginBottom = "20px";


    // Container para info de atualização e botão de recálculo
    const updateContainer = document.createElement("div");
    updateContainer.style.display = "flex";
    updateContainer.style.alignItems = "center";
    updateContainer.style.gap = "12px";

    // Info de última atualização (será preenchida após verificar)
    const lastUpdateInfo = document.createElement("div");
    lastUpdateInfo.id = "kpiLastUpdateInfo";
    lastUpdateInfo.style.fontSize = "12px";
    lastUpdateInfo.style.color = "#666";
    lastUpdateInfo.style.textAlign = "right";
    lastUpdateInfo.innerHTML = '<i class="fa fa-clock"></i> Verificando última atualização...';
    updateContainer.appendChild(lastUpdateInfo);

    // Botão de recálculo manual
    const recalcButton = document.createElement("button");
    recalcButton.id = "kpiRecalcButton";
    recalcButton.className = "btn btn-sm btn-outline-secondary";
    recalcButton.innerHTML = '<i class="fa fa-refresh"></i>';
    recalcButton.title = "Recalcular KPIs manualmente";
    recalcButton.style.padding = "4px 8px";
    recalcButton.style.fontSize = "12px";
    recalcButton.style.display = "none"; // Escondido até carregar
    recalcButton.addEventListener("click", handleManualKPIRecalc);
    updateContainer.appendChild(recalcButton);

    headerWrapper.appendChild(updateContainer);

    container.appendChild(headerWrapper);

    createTabs(container);

    const tableContainer = document.createElement("div");
    tableContainer.id = "dentistProductivityTableContainer";
    container.appendChild(tableContainer);

    // Spinner de carregamento com UX melhorada
    const loadingOverlay = document.createElement("div");
    loadingOverlay.id = "kpiLoadingOverlay";
    loadingOverlay.style.cssText = `
      padding: 40px 20px;
      text-align: center;
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e8eb 100%);
      border-radius: 8px;
      margin: 20px 0;
    `;

    const spinnerIcon = document.createElement("div");
    spinnerIcon.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size: 32px; color: #007bff; margin-bottom: 15px;"></i>';
    loadingOverlay.appendChild(spinnerIcon);

    const loadingText = document.createElement("div");
    loadingText.id = "kpiLoadingText";
    loadingText.style.cssText = "font-size: 16px; color: #333; font-weight: 500;";
    loadingText.textContent = "Carregando dados de produtividade...";
    loadingOverlay.appendChild(loadingText);

    const loadingSubtext = document.createElement("div");
    loadingSubtext.id = "kpiLoadingSubtext";
    loadingSubtext.style.cssText = "font-size: 12px; color: #666; margin-top: 8px;";
    loadingSubtext.textContent = "Verificando última atualização dos KPIs...";
    loadingOverlay.appendChild(loadingSubtext);

    container.appendChild(loadingOverlay);

    // Iniciar carregamento com verificação automática de recálculo
    loadProductivityDataWithAutoRecalc(tableContainer, loadingOverlay, lastUpdateInfo);
  }

  /**
   * Carrega dados de produtividade com verificação automática de recálculo diário
   * Se os KPIs não foram calculados hoje, executa o recálculo em background
   * Usa dados cacheados quando disponíveis para evitar discrepância com hora exibida
   */
  async function loadProductivityDataWithAutoRecalc(tableContainer, loadingOverlay, lastUpdateInfo) {
    try {
      // 1. Verificar se precisa recalcular KPIs
      const loadingSubtext = document.getElementById("kpiLoadingSubtext");
      const loadingText = document.getElementById("kpiLoadingText");

      if (loadingSubtext) loadingSubtext.textContent = "Verificando última atualização dos KPIs...";

      const configResponse = await sendServiceMessage({ command: "getKPIConfig" });
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      let needsRecalc = true;
      let lastRecalcDate = null;
      let lastRecalcTime = null;
      let cachedDentists = null;

      if (configResponse.status === 'success' && configResponse.data) {
        lastRecalcDate = configResponse.data.lastFullRecalculation;
        lastRecalcTime = configResponse.data.lastRecalculationTime;
        cachedDentists = configResponse.data.cachedDentists;

        console.log('[CIROD] Config carregada:', {
          lastRecalcDate,
          lastRecalcTime,
          today,
          hasCachedDentists: !!cachedDentists,
          cachedCount: cachedDentists?.length || 0
        });

        if (lastRecalcDate === today) {
          needsRecalc = false;
          console.log('[CIROD] KPIs já calculados hoje:', lastRecalcDate, 'às', lastRecalcTime);
        } else {
          console.log('[CIROD] KPIs desatualizados. Último cálculo:', lastRecalcDate || 'nunca');
        }
      } else {
        console.log('[CIROD] Configuração de KPIs não encontrada, primeiro acesso');
      }

      // 2. Se precisa recalcular, fazer em background
      if (needsRecalc) {
        if (loadingText) loadingText.textContent = "Atualizando KPIs...";
        if (loadingSubtext) {
          loadingSubtext.textContent = 'Primeira atualização do dia, recalculando dados...';
        }

        console.log('[CIROD] Iniciando recálculo automático de KPIs...');
        const recalcResponse = await sendServiceMessage({ command: "recalculateAllKPIs" });

        if (recalcResponse.status === 'success') {
          console.log('[CIROD] Recálculo concluído:', recalcResponse.message);

          // Atualizar data do último cálculo
          const now = new Date();
          lastRecalcDate = today;
          lastRecalcTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          // Buscar dados atualizados e cachear
          if (loadingText) loadingText.textContent = "Carregando dados dos dentistas...";
          if (loadingSubtext) loadingSubtext.textContent = "Buscando informações de produtividade...";

          const dentists = await queryDentistsProductivity();

          // Preparar dados para cache (apenas campos essenciais)
          const dentistsForCache = dentists.map(d => ({
            dentist_id: d.dentist_id,
            dentist_name: d.dentist_name,
            dentist_cro: d.dentist_cro,
            dentist_email: d.dentist_email,
            mobile_phone: d.mobile_phone,
            commercial_phone: d.commercial_phone,
            dental_clinics: d.dental_clinics,
            KPIs: d.KPIs
          }));

          // Salvar config com dados cacheados
          await sendServiceMessage({
            command: "setKPIConfig",
            data: {
              lastFullRecalculation: today,
              lastRecalculationTime: lastRecalcTime,
              cachedDentists: dentistsForCache
            }
          });

          console.log('[CIROD] Config salva após recálculo automático:', dentistsForCache.length, 'dentistas cacheados');

          // Usar os dados recém-buscados
          cachedDentists = dentists;
        } else {
          console.error('[CIROD] Erro no recálculo:', recalcResponse.message);
        }
      }

      // 3. Atualizar info de última atualização
      if (lastUpdateInfo) {
        if (lastRecalcDate && lastRecalcTime) {
          const displayDate = formatDateBR(lastRecalcDate);
          lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate} às ${lastRecalcTime}`;
        } else if (lastRecalcDate) {
          const displayDate = formatDateBR(lastRecalcDate);
          lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate}`;
        } else {
          lastUpdateInfo.innerHTML = `<i class="fa fa-info-circle" style="color: #ffc107;"></i> Dados sendo carregados pela primeira vez`;
        }
      }

      // 4. Carregar dados dos dentistas (usar cache se disponível)
      let dentists;

      if (cachedDentists && cachedDentists.length > 0) {
        // Usar dados cacheados - garantem consistência com a hora exibida
        console.log('[CIROD] Usando dados cacheados:', cachedDentists.length, 'dentistas');
        dentists = cachedDentists;

        if (loadingText) loadingText.textContent = "Carregando dados em cache...";
        if (loadingSubtext) loadingSubtext.textContent = "Usando dados da última atualização...";
      } else {
        // Buscar do banco (fallback)
        console.log('[CIROD] Sem cache disponível, buscando do banco...');
        if (loadingText) loadingText.textContent = "Carregando dados dos dentistas...";
        if (loadingSubtext) loadingSubtext.textContent = "Buscando informações de produtividade...";

        dentists = await queryDentistsProductivity();
      }

      // Mostrar progresso de processamento
      if (loadingSubtext && dentists.length > 0) {
        loadingSubtext.textContent = `Analisando dentistas... (${dentists.length}/${dentists.length})`;
      }

      // Remover overlay de carregamento
      if (loadingOverlay) loadingOverlay.remove();

      console.log("[CIROD Produtividade] Dados carregados:", dentists.length, "dentistas");

      // Debug: Verificar estrutura de KPIs dos primeiros dentistas
      if (dentists.length > 0) {
        console.log('[CIROD Debug] Estrutura do primeiro dentista:', {
          dentist_id: dentists[0].dentist_id,
          dentist_name: dentists[0].dentist_name,
          hasKPIs: !!dentists[0].KPIs
        });
      }

      // Contar dentistas com KPIs
      const withKPIs = dentists.filter(d => d.KPIs && Object.keys(d.KPIs.periodKPIs || {}).length > 0);
      console.log(`[CIROD Produtividade] Dentistas com KPIs: ${withKPIs.length} de ${dentists.length}`);

      productivityDentists = dentists;
      currentPage = 1;
      currentSort = { column: "lastMonthRevenue", direction: "desc" };
      currentMode = 0; // Geral
      renderDentistTablePage(tableContainer);

      // Mostrar botão de recálculo manual após carregamento bem-sucedido
      const recalcButton = document.getElementById("kpiRecalcButton");
      if (recalcButton) {
        recalcButton.style.display = "";
      }

    } catch (err) {
      console.error("[CIROD Produtividade] Erro:", err);

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
   * Handler para recálculo manual de KPIs
   * Permite ao usuário forçar um recálculo mesmo que já tenha sido feito hoje
   */
  async function handleManualKPIRecalc() {
    const recalcButton = document.getElementById("kpiRecalcButton");
    const lastUpdateInfo = document.getElementById("kpiLastUpdateInfo");
    const tableContainer = document.getElementById("dentistProductivityTableContainer");

    if (!recalcButton) return;

    // Confirmar ação
    if (!confirm("Deseja recalcular todos os KPIs?\nIsso pode demorar alguns segundos.")) {
      return;
    }

    // Desabilitar botão e mostrar loading
    recalcButton.disabled = true;
    recalcButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    recalcButton.title = "Recalculando...";

    if (lastUpdateInfo) {
      lastUpdateInfo.innerHTML = '<i class="fa fa-sync fa-spin" style="color: #007bff;"></i> Recalculando KPIs...';
    }

    try {
      // Executar recálculo
      const recalcResponse = await sendServiceMessage({ command: "recalculateAllKPIs" });

      if (recalcResponse.status === 'success') {
        // Atualizar data do último cálculo
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const lastRecalcTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        // Recarregar dados da tabela
        if (tableContainer) {
          tableContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;"><i class="fa fa-spinner fa-spin"></i> Recarregando dados...</div>';
        }

        const dentists = await queryDentistsProductivity();
        productivityDentists = dentists;

        // Preparar dados para cache (apenas campos essenciais para reduzir tamanho)
        const dentistsForCache = dentists.map(d => ({
          dentist_id: d.dentist_id,
          dentist_name: d.dentist_name,
          dentist_cro: d.dentist_cro,
          dentist_email: d.dentist_email,
          mobile_phone: d.mobile_phone,
          commercial_phone: d.commercial_phone,
          dental_clinics: d.dental_clinics,
          KPIs: d.KPIs
        }));

        // Salvar config com dados cacheados
        const configSaveResponse = await sendServiceMessage({
          command: "setKPIConfig",
          data: {
            lastFullRecalculation: today,
            lastRecalculationTime: lastRecalcTime,
            cachedDentists: dentistsForCache
          }
        });

        console.log('[CIROD] Config salva após recálculo manual:', configSaveResponse.status, 'Data:', today, 'Hora:', lastRecalcTime, 'Dentistas:', dentistsForCache.length);

        // Atualizar info
        if (lastUpdateInfo) {
          const displayDate = formatDateBR(today);
          lastUpdateInfo.innerHTML = `<i class="fa fa-check-circle" style="color: #28a745;"></i> Última atualização: ${displayDate} às ${lastRecalcTime}`;
        }

        currentPage = 1;
        renderDentistTablePage(tableContainer);

        console.log('[CIROD] Recálculo manual de KPIs concluído:', recalcResponse.message);
      } else {
        throw new Error(recalcResponse.message || 'Erro desconhecido');
      }
    } catch (error) {
      console.error('[CIROD] Erro no recálculo manual:', error);
      alert("Erro ao recalcular KPIs: " + error.message);

      if (lastUpdateInfo) {
        lastUpdateInfo.innerHTML = '<i class="fa fa-exclamation-circle" style="color: #dc3545;"></i> Erro no recálculo';
      }
    } finally {
      // Restaurar botão
      recalcButton.disabled = false;
      recalcButton.innerHTML = '<i class="fa fa-refresh"></i>';
      recalcButton.title = "Recalcular KPIs manualmente";
    }
  }

  /**
   * Cria as abas de filtro (unidades habilitadas e desabilitadas)
   */
  function createTabs(parentContainer) {
    const tabsWrapper = document.createElement("div");
    tabsWrapper.style.marginBottom = "15px";

    const tabsContainer = document.createElement("div");
    tabsContainer.style.display = "flex";
    tabsContainer.style.flexWrap = "wrap";
    tabsContainer.style.gap = "8px";
    tabsContainer.id = "productivityTabs";

    CIROD_UNITS_UI.forEach((unit, index) => {
      const tab = document.createElement("button");
      tab.textContent = unit.name;
      tab.className = "btn tab-btn";
      tab.dataset.unitId = unit.id;
      tab.dataset.enabled = unit.enabled !== false ? "true" : "false";

      // Estilizar aba (habilitada ou desabilitada)
      styleTabButton(tab, unit.color, index === 0, unit.enabled !== false);

      // Apenas adicionar evento de clique se a unidade estiver habilitada
      if (unit.enabled !== false) {
        tab.addEventListener("click", () => {
          currentMode = unit.id;
          currentPage = 1;
          currentSort = { column: "lastMonthRevenue", direction: "desc" };
          updateTabsActive(unit.id);
          renderDentistTablePage(document.getElementById("dentistProductivityTableContainer"));
        });
      } else {
        // Tooltip para abas desabilitadas
        tab.title = "Unidade ainda não mapeada - ID do Cfaz pendente";
      }

      tabsContainer.appendChild(tab);
    });

    tabsWrapper.appendChild(tabsContainer);
    parentContainer.appendChild(tabsWrapper);
  }

  /**
   * Estiliza um botão de aba
   * @param {HTMLElement} btn - Botão a estilizar
   * @param {string} color - Cor da unidade
   * @param {boolean} active - Se a aba está ativa
   * @param {boolean} enabled - Se a unidade está habilitada (ID do Cfaz confirmado)
   */
  function styleTabButton(btn, color, active, enabled = true) {
    btn.style.padding = "6px 12px";
    btn.style.fontSize = "13px";
    btn.style.fontWeight = "bold";
    btn.style.borderRadius = "4px";
    btn.style.transition = "all 0.2s";

    if (!enabled) {
      // Estilo para unidades desabilitadas (ID não mapeado)
      btn.style.border = "2px dashed #ccc";
      btn.style.backgroundColor = "#f5f5f5";
      btn.style.color = "#999";
      btn.style.cursor = "not-allowed";
      btn.style.opacity = "0.6";
    } else if (active) {
      // Estilo para aba ativa
      btn.style.border = `2px solid ${color}`;
      btn.style.backgroundColor = color;
      btn.style.color = "#fff";
      btn.style.cursor = "pointer";
      btn.style.opacity = "1";
    } else {
      // Estilo para aba inativa mas habilitada
      btn.style.border = `2px solid ${color}`;
      btn.style.backgroundColor = "#fff";
      btn.style.color = color;
      btn.style.cursor = "pointer";
      btn.style.opacity = "1";
    }
  }

  /**
   * Atualiza o estado ativo das abas
   */
  function updateTabsActive(activeUnitId) {
    const tabs = document.querySelectorAll("#productivityTabs .tab-btn");
    tabs.forEach((tab) => {
      const unitId = parseInt(tab.dataset.unitId);
      const isEnabled = tab.dataset.enabled === "true";
      const unit = CIROD_UNITS_UI.find((u) => u.id === unitId);
      if (unit) {
        styleTabButton(tab, unit.color, unitId === activeUnitId, isEnabled);
      }
    });
  }

  /**
   * Fecha o módulo de produtividade e restaura o conteúdo principal
   */
  function closeDentistProductivityModule() {
    if (typeof showMainContent === "function") {
      showMainContent();
    }
  }

  /**
   * Consulta dentistas no DynamoDB
   * Usa sendServiceMessage do awsConfig.js para comunicação centralizada
   */
  function queryDentistsProductivity() {
    // Verificar se o contexto da extensão está válido
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[CIROD Produtividade] Contexto invalidado, recarregue a página');
      return Promise.resolve([]);
    }

    return sendServiceMessage({ command: "scanDentistsKPIs" })
      .then(response => {
        if (response.status === 'cancelled') {
          console.log('[CIROD Produtividade] Operação cancelada, tentando novamente...');
          // Tentar novamente após um pequeno delay
          return new Promise(resolve => {
            setTimeout(() => {
              // Verificar novamente se o contexto está válido
              if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
                console.warn('[CIROD Produtividade] Contexto invalidado no retry');
                resolve([]);
                return;
              }
              sendServiceMessage({ command: "scanDentistsKPIs" })
                .then(retryResponse => resolve(retryResponse.data || []))
                .catch(() => resolve([]));
            }, 500);
          });
        }
        return response.data || [];
      })
      .catch(error => {
        console.error('[CIROD Produtividade] Erro na consulta:', error);
        return [];
      });
  }

  /**
   * Renderiza a página da tabela
   */
  function renderDentistTablePage(container) {
    container.innerHTML = "";

    const currentUnit = CIROD_UNITS_UI.find((u) => u.id === currentMode) || CIROD_UNITS_UI[0];
    const borderColor = currentUnit.color;

    let sortedDentists = productivityDentists.slice();

    // Ordenação
    if (currentSort.column) {
      sortedDentists.sort((a, b) => {
        let aValue, bValue;
        switch (currentSort.column) {
          case "lastMonthRevenue": {
            aValue = getMonthlyRevenueValue(a, lastMonthYear, lastMonth, currentMode);
            bValue = getMonthlyRevenueValue(b, lastMonthYear, lastMonth, currentMode);
            break;
          }
          case "differenceRevenue": {
            aValue = computeDifference(a, currentMode);
            bValue = computeDifference(b, currentMode);
            break;
          }
          case "penultMonthRevenue": {
            aValue = getMonthlyRevenueValue(a, penultMonthYear, penultMonth, currentMode);
            bValue = getMonthlyRevenueValue(b, penultMonthYear, penultMonth, currentMode);
            break;
          }
          case "lastMonthOrders":
            aValue = getMonthlyOrdersValue(a, lastMonthYear, lastMonth, currentMode);
            bValue = getMonthlyOrdersValue(b, lastMonthYear, lastMonth, currentMode);
            break;
          case "penultMonthOrders":
            aValue = getMonthlyOrdersValue(a, penultMonthYear, penultMonth, currentMode);
            bValue = getMonthlyOrdersValue(b, penultMonthYear, penultMonth, currentMode);
            break;
          default:
            aValue = 0;
            bValue = 0;
        }
        return currentSort.direction === "asc" ? aValue - bValue : bValue - aValue;
      });
    }

    const totalDentists = sortedDentists.length;
    const totalPages = Math.ceil(totalDentists / pageSize);
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

    const pageDentists = sortedDentists.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    );

    // Tabela
    const table = document.createElement("table");
    table.id = "dentistProductivityTable";
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.borderRadius = "8px";
    table.style.overflow = "hidden";
    table.style.boxShadow = `0 0 0 4px ${borderColor}`;

    // Cabeçalho
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const headers = [
      { label: "Nome do Dentista", sortable: false },
      { label: "Bairros", sortable: false },
      { label: `Faturado ${formatMonthYear(lastMonthYear, lastMonth)}`, sortable: true, key: "lastMonthRevenue" },
      { label: "Diferença", sortable: true, key: "differenceRevenue" },
      { label: `Faturado ${formatMonthYear(penultMonthYear, penultMonth)}`, sortable: true, key: "penultMonthRevenue" },
      { label: `Pedidos ${formatMonthYear(lastMonthYear, lastMonth)}`, sortable: true, key: "lastMonthOrders" },
      { label: `Pedidos ${formatMonthYear(penultMonthYear, penultMonth)}`, sortable: true, key: "penultMonthOrders" },
    ];

    headers.forEach((headerObj) => {
      const th = document.createElement("th");
      th.style.padding = "8px";
      th.style.border = `1px solid ${borderColor}`;
      th.style.position = "relative";
      th.style.whiteSpace = "nowrap";

      // Criar span para o texto
      const textSpan = document.createElement("span");
      textSpan.textContent = headerObj.label;
      th.appendChild(textSpan);

      if (headerObj.sortable && headerObj.key) {
        th.style.cursor = "pointer";

        // Criar span para o ícone de ordenação
        const iconSpan = document.createElement("span");
        iconSpan.style.marginLeft = "6px";
        iconSpan.style.fontSize = "10px";
        iconSpan.style.opacity = currentSort.column === headerObj.key ? "1" : "0.4";

        // Ícone baseado no estado de ordenação
        if (currentSort.column === headerObj.key) {
          // Coluna ativa: mostrar direção atual
          iconSpan.innerHTML = currentSort.direction === "asc"
            ? '<i class="fa fa-sort-up"></i>'
            : '<i class="fa fa-sort-down"></i>';
        } else {
          // Coluna inativa: mostrar ícone neutro indicando que é ordenável
          iconSpan.innerHTML = '<i class="fa fa-sort"></i>';
        }

        th.appendChild(iconSpan);

        // Hover effect
        th.addEventListener("mouseenter", () => {
          th.style.backgroundColor = "rgba(0,0,0,0.05)";
        });
        th.addEventListener("mouseleave", () => {
          th.style.backgroundColor = "";
        });

        th.addEventListener("click", () => {
          if (currentSort.column === headerObj.key) {
            currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
          } else {
            currentSort.column = headerObj.key;
            currentSort.direction = "asc";
          }
          renderDentistTablePage(container);
        });
      }

      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Corpo
    const tbody = document.createElement("tbody");

    pageDentists.forEach((dentist, index) => {
      const row = document.createElement("tr");
      row.style.backgroundColor = index % 2 === 0 ? "#fff" : "#f9f9f9";

      // Nome
      const tdName = document.createElement("td");
      tdName.style.padding = "8px";
      tdName.style.border = `1px solid ${borderColor}`;
      tdName.style.display = "flex";
      tdName.style.alignItems = "center";
      tdName.style.gap = "8px";

      // Link para perfil do dentista (abre em nova aba)
      const profileLink = document.createElement("a");
      profileLink.href = `/usr/dentist_data/${dentist.dentist_id}`;
      profileLink.target = "_blank";
      profileLink.title = "Abrir perfil do dentista";
      profileLink.style.display = "inline-flex";
      profileLink.style.alignItems = "center";
      profileLink.style.color = "#666";
      profileLink.style.textDecoration = "none";
      profileLink.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
      profileLink.addEventListener("mouseenter", () => { profileLink.style.color = borderColor; });
      profileLink.addEventListener("mouseleave", () => { profileLink.style.color = "#666"; });
      tdName.appendChild(profileLink);

      // Ícone de gráfico para abrir modal com detalhes
      const chartIcon = document.createElement("a");
      chartIcon.href = "#";
      chartIcon.title = "Ver gráfico de produtividade";
      chartIcon.style.display = "inline-flex";
      chartIcon.style.alignItems = "center";
      chartIcon.style.textDecoration = "none";
      chartIcon.style.cursor = "pointer";

      const chartImg = document.createElement("img");
      chartImg.src = chrome.runtime.getURL("images/grafico-icon.png");
      chartImg.alt = "Gráfico";
      chartImg.style.width = "16px";
      chartImg.style.height = "16px";
      chartImg.style.opacity = "0.6";
      chartImg.style.transition = "opacity 0.2s";
      chartIcon.appendChild(chartImg);

      chartIcon.addEventListener("mouseenter", () => { chartImg.style.opacity = "1"; });
      chartIcon.addEventListener("mouseleave", () => { chartImg.style.opacity = "0.6"; });
      chartIcon.addEventListener("click", (e) => {
        e.preventDefault();
        showDentistModal(dentist);
      });
      tdName.appendChild(chartIcon);

      // Nome do dentista (sem link para modal)
      const nameSpan = document.createElement("span");
      nameSpan.textContent = dentist.dentist_name || "Sem nome";
      nameSpan.style.fontWeight = "500";
      tdName.appendChild(nameSpan);
      row.appendChild(tdName);

      // Bairros
      const tdNeighborhoods = document.createElement("td");
      tdNeighborhoods.style.padding = "8px";
      tdNeighborhoods.style.border = `1px solid ${borderColor}`;
      const neighborhoods = getNeighborhoods(dentist);
      tdNeighborhoods.textContent = neighborhoods.slice(0, 2).join(", ");
      tdNeighborhoods.style.fontSize = "12px";
      row.appendChild(tdNeighborhoods);

      // Faturado último mês
      const tdLastRevenue = document.createElement("td");
      tdLastRevenue.style.padding = "8px";
      tdLastRevenue.style.border = `1px solid ${borderColor}`;
      tdLastRevenue.style.textAlign = "right";
      tdLastRevenue.textContent = getMonthlyRevenue(dentist, lastMonthYear, lastMonth, currentMode);
      row.appendChild(tdLastRevenue);

      // Diferença
      const tdDiff = document.createElement("td");
      tdDiff.style.padding = "8px";
      tdDiff.style.border = `1px solid ${borderColor}`;
      tdDiff.style.textAlign = "right";
      const diff = computeDifference(dentist, currentMode);
      tdDiff.textContent = formatCurrency(diff);
      tdDiff.style.color = diff >= 0 ? "green" : "red";
      tdDiff.style.fontWeight = "bold";
      row.appendChild(tdDiff);

      // Faturado penúltimo mês
      const tdPenultRevenue = document.createElement("td");
      tdPenultRevenue.style.padding = "8px";
      tdPenultRevenue.style.border = `1px solid ${borderColor}`;
      tdPenultRevenue.style.textAlign = "right";
      tdPenultRevenue.textContent = getMonthlyRevenue(dentist, penultMonthYear, penultMonth, currentMode);
      row.appendChild(tdPenultRevenue);

      // Pedidos último mês
      const tdLastOrders = document.createElement("td");
      tdLastOrders.style.padding = "8px";
      tdLastOrders.style.border = `1px solid ${borderColor}`;
      tdLastOrders.style.textAlign = "center";
      tdLastOrders.textContent = getMonthlyOrders(dentist, lastMonthYear, lastMonth, currentMode);
      row.appendChild(tdLastOrders);

      // Pedidos penúltimo mês
      const tdPenultOrders = document.createElement("td");
      tdPenultOrders.style.padding = "8px";
      tdPenultOrders.style.border = `1px solid ${borderColor}`;
      tdPenultOrders.style.textAlign = "center";
      tdPenultOrders.textContent = getMonthlyOrders(dentist, penultMonthYear, penultMonth, currentMode);
      row.appendChild(tdPenultOrders);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);

    // Paginação
    if (totalPages > 1) {
      const pagination = createPagination(totalPages, borderColor, container);
      container.appendChild(pagination);
    }

    // Info
    const info = document.createElement("div");
    info.style.marginTop = "10px";
    info.style.fontSize = "12px";
    info.style.color = "#666";
    info.textContent = `Mostrando ${pageDentists.length} de ${totalDentists} dentistas (Página ${currentPage} de ${totalPages})`;
    container.appendChild(info);
  }

  /**
   * Cria controles de paginação
   */
  function createPagination(totalPages, borderColor, tableContainer) {
    const pagination = document.createElement("div");
    pagination.style.display = "flex";
    pagination.style.justifyContent = "center";
    pagination.style.gap = "5px";
    pagination.style.marginTop = "15px";

    // Botão anterior
    if (currentPage > 1) {
      const prevBtn = document.createElement("button");
      prevBtn.textContent = "« Anterior";
      prevBtn.className = "btn btn-sm";
      prevBtn.style.border = `1px solid ${borderColor}`;
      prevBtn.style.color = borderColor;
      prevBtn.addEventListener("click", () => {
        currentPage--;
        renderDentistTablePage(tableContainer);
      });
      pagination.appendChild(prevBtn);
    }

    // Números de página
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement("button");
      pageBtn.textContent = i;
      pageBtn.className = "btn btn-sm";
      pageBtn.style.border = `1px solid ${borderColor}`;

      if (i === currentPage) {
        pageBtn.style.backgroundColor = borderColor;
        pageBtn.style.color = "#fff";
      } else {
        pageBtn.style.color = borderColor;
        pageBtn.addEventListener("click", () => {
          currentPage = i;
          renderDentistTablePage(tableContainer);
        });
      }

      pagination.appendChild(pageBtn);
    }

    // Botão próximo
    if (currentPage < totalPages) {
      const nextBtn = document.createElement("button");
      nextBtn.textContent = "Próximo »";
      nextBtn.className = "btn btn-sm";
      nextBtn.style.border = `1px solid ${borderColor}`;
      nextBtn.style.color = borderColor;
      nextBtn.addEventListener("click", () => {
        currentPage++;
        renderDentistTablePage(tableContainer);
      });
      pagination.appendChild(nextBtn);
    }

    return pagination;
  }

  /**
   * Exibe modal com gráfico do dentista
   */
  async function showDentistModal(dentist) {
    // Remove modal existente
    const existingModal = document.getElementById("dentistChartModal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "dentistChartModal";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0,0,0,0.5)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "9999";

    const modalContent = document.createElement("div");
    modalContent.style.backgroundColor = "#fff";
    modalContent.style.padding = "20px";
    modalContent.style.borderRadius = "8px";
    modalContent.style.width = "80%";
    modalContent.style.maxWidth = "800px";
    modalContent.style.maxHeight = "80%";
    modalContent.style.overflow = "auto";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.float = "right";
    closeBtn.style.fontSize = "24px";
    closeBtn.style.border = "none";
    closeBtn.style.background = "none";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => modal.remove());
    modalContent.appendChild(closeBtn);

    const title = document.createElement("h3");
    title.textContent = dentist.dentist_name || "Dentista";
    title.style.marginTop = "0";
    modalContent.appendChild(title);

    // Informações
    const info = document.createElement("div");
    info.style.marginBottom = "20px";
    info.style.lineHeight = "1.8";

    // Formatar emails
    const emails = dentist.dentist_email;
    const emailStr = Array.isArray(emails) ? emails.join(", ") : (emails || "Dado não cadastrado");

    // Formatar telefones
    const phones = [dentist.mobile_phone, dentist.commercial_phone].filter(p => p).join(" / ") || "Dado não cadastrado";

    // Formatar bairros
    const bairros = getNeighborhoods(dentist).join(", ") || "Dado não cadastrado";

    info.innerHTML = `
      <p><strong>ID:</strong> ${dentist.dentist_id || "Dado não cadastrado"} | <strong>CRO:</strong> ${dentist.dentist_cro || "Dado não cadastrado"}</p>
      <p><strong>Email:</strong> ${emailStr}</p>
      <p><strong>Telefone:</strong> ${phones}</p>
      <p><strong>Bairros:</strong> ${bairros}</p>
    `;
    modalContent.appendChild(info);

    // Canvas para gráfico
    const chartContainer = document.createElement("div");
    chartContainer.style.height = "300px";
    const canvas = document.createElement("canvas");
    canvas.id = "dentistChart";
    chartContainer.appendChild(canvas);
    modalContent.appendChild(chartContainer);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Fechar ao clicar fora
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    // Verificar se Chart.js está disponível antes de renderizar o gráfico
    const chartAvailable = await ensureChartJS();
    if (chartAvailable) {
      renderDentistChart(canvas, dentist);
    } else {
      chartContainer.innerHTML = "<p style='color: #cc0000;'>Erro: Chart.js não disponível. Recarregue a página.</p>";
    }
  }

  /**
   * Renderiza gráfico de evolução do dentista
   */
  function renderDentistChart(canvas, dentist) {
    if (!window.Chart) {
      canvas.parentElement.innerHTML = "<p>Chart.js não disponível</p>";
      return;
    }

    const months = [];
    const revenues = [];
    const orders = [];

    // Últimos 12 meses
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear().toString();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      months.push(`${month}/${year}`);

      const revenue = getMonthlyRevenueValue(dentist, year, month, currentMode);
      const order = getMonthlyOrdersValue(dentist, year, month, currentMode);
      revenues.push(revenue);
      orders.push(order);
    }

    new Chart(canvas, {
      type: "bar",
      data: {
        labels: months,
        datasets: [
          {
            label: "Faturamento (R$)",
            data: revenues,
            backgroundColor: "rgba(54, 162, 235, 0.5)",
            borderColor: "rgba(54, 162, 235, 1)",
            borderWidth: 1,
            yAxisID: "y",
          },
          {
            label: "Pedidos",
            data: orders,
            type: "line",
            borderColor: "rgba(255, 99, 132, 1)",
            backgroundColor: "rgba(255, 99, 132, 0.2)",
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Faturamento (R$)" },
          },
          y1: {
            type: "linear",
            position: "right",
            title: { display: true, text: "Pedidos" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  // ========== FUNÇÕES AUXILIARES ==========

  /**
   * Retorna o mês atual e o mês anterior
   * Alterado de "últimos 2 meses concluídos" para incluir o mês atual,
   * já que os KPIs são calculados em tempo real conforme requisições são salvas
   */
  function getLastTwoConcludedMonths() {
    const now = new Date();
    // Mês atual (dados em andamento)
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    // Mês anterior (dados consolidados)
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    return {
      lastMonthYear: currentMonthDate.getFullYear().toString(),
      lastMonth: String(currentMonthDate.getMonth() + 1).padStart(2, "0"),
      penultMonthYear: lastMonthDate.getFullYear().toString(),
      penultMonth: String(lastMonthDate.getMonth() + 1).padStart(2, "0"),
    };
  }

  /**
   * Formata mês/ano
   */
  function formatMonthYear(year, month) {
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${monthNames[parseInt(month) - 1]}/${year}`;
  }

  /**
   * Formata valor em moeda
   */
  function formatCurrency(value) {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  /**
   * Obtém bairros do dentista
   */
  function getNeighborhoods(dentist) {
    if (!dentist.dental_clinics || !Array.isArray(dentist.dental_clinics)) {
      return [];
    }
    return dentist.dental_clinics
      .map((clinic) => clinic.neighborhood)
      .filter((n) => n);
  }

  /**
   * Obtém o sufixo de campo para a unidade atual
   */
  function getFieldSuffix(mode) {
    const unit = CIROD_UNITS_UI.find((u) => u.id === mode);
    return unit ? unit.fieldSuffix : "TotalMes";
  }

  /**
   * Obtém faturamento mensal formatado
   */
  function getMonthlyRevenue(dentist, year, month, mode) {
    const value = getMonthlyRevenueValue(dentist, year, month, mode);
    return formatCurrency(value);
  }

  /**
   * Obtém valor numérico do faturamento mensal
   */
  function getMonthlyRevenueValue(dentist, year, month, mode) {
    const suffix = getFieldSuffix(mode);
    const fieldName = `faturamento${suffix}`;

    try {
      // Debug: Log apenas para o primeiro dentista
      if (dentist === productivityDentists[0]) {
        console.log('[CIROD Debug] getMonthlyRevenueValue:', {
          dentist_name: dentist.dentist_name,
          year,
          month,
          mode,
          fieldName,
          hasKPIs: !!dentist.KPIs,
          hasPeriodKPIs: !!dentist.KPIs?.periodKPIs,
          years: dentist.KPIs?.periodKPIs ? Object.keys(dentist.KPIs.periodKPIs) : [],
          KPIs: dentist.KPIs
        });
      }

      const kpis = dentist.KPIs?.periodKPIs?.[year]?.[month];
      if (!kpis) return 0;
      return parseFloat(kpis[fieldName]) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Obtém pedidos mensais formatados
   */
  function getMonthlyOrders(dentist, year, month, mode) {
    return getMonthlyOrdersValue(dentist, year, month, mode).toString();
  }

  /**
   * Obtém valor numérico dos pedidos mensais
   */
  function getMonthlyOrdersValue(dentist, year, month, mode) {
    const suffix = getFieldSuffix(mode);
    // ID 0 = Geral usa "totalPedidos", outros usam "totalPedidos{Suffix}"
    const fieldName = mode === 0 ? "totalPedidos" : `totalPedidos${suffix}`;

    try {
      const kpis = dentist.KPIs?.periodKPIs?.[year]?.[month];
      if (!kpis) return 0;
      return parseInt(kpis[fieldName]) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calcula diferença entre último e penúltimo mês
   */
  function computeDifference(dentist, mode) {
    const lastValue = getMonthlyRevenueValue(dentist, lastMonthYear, lastMonth, mode);
    const penultValue = getMonthlyRevenueValue(dentist, penultMonthYear, penultMonth, mode);
    return lastValue - penultValue;
  }

  // ========== FUNÇÕES DE VISIBILIDADE ==========

  // IDs de todos os módulos de controle CIROD
  const CIROD_CONTROL_MODULES = [
    "dentistProductivityModule",
    "partnershipHealthModule"
  ];

  /**
   * Remove todos os módulos de controle CIROD
   * Chamado antes de abrir um novo módulo para evitar sobreposição
   */
  window.clearAllCIRODModules = function () {
    CIROD_CONTROL_MODULES.forEach(id => {
      const module = document.getElementById(id);
      if (module) module.remove();
    });
  };

  /**
   * Esconde o conteúdo principal do Cfaz
   * Chamado antes de exibir um módulo de controle
   */
  window.hideMainContent = function () {
    // Primeiro, limpar todos os módulos de controle existentes
    window.clearAllCIRODModules();

    const mainContent = document.querySelector("#content > div");
    if (!mainContent) return;
    Array.from(mainContent.children).forEach((child) => {
      child.style.display = "none";
    });
  };

  /**
   * Restaura o conteúdo principal do Cfaz
   * Chamado ao fechar um módulo de controle
   */
  window.showMainContent = function () {
    // Limpar todos os módulos de controle
    window.clearAllCIRODModules();

    const mainContent = document.querySelector("#content > div");
    if (!mainContent) return;
    Array.from(mainContent.children).forEach((child) => {
      child.style.display = "";
    });
  };

  // ========== INICIALIZAÇÃO ==========
  // Cfaz é um SPA que usa Turbo - usar apenas turbo:load
  document.addEventListener("turbo:load", initDentistProductivityModule);
})();
