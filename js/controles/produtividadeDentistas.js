/**
 * produtividadeDentistas.js - Assistente CIROD
 * Página de controle de produtividade dos dentistas
 * Com 14 abas: Geral + 13 unidades CIROD
 */

(function () {
  // Carregar Chart.js dinamicamente - chamado apenas quando necessário
  function loadChartJS() {
    return new Promise((resolve) => {
      if (window.Chart) {
        resolve();
        return;
      }
      // Verificar se o contexto da extensão ainda é válido
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        console.warn('[CIROD] Contexto da extensão invalidado, Chart.js não será carregado');
        resolve();
        return;
      }
      try {
        const chartUrl = chrome.runtime.getURL("utils/chart-min.js");
        const script = document.createElement("script");
        script.src = chartUrl;
        script.onerror = () => {
          console.warn('[CIROD] Erro ao carregar Chart.js');
          resolve();
        };
        script.onload = () => {
          if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
            resolve();
            return;
          }
          try {
            const plugin = document.createElement("script");
            plugin.src = chrome.runtime.getURL("utils/chart-minPlugIn.js");
            plugin.onload = resolve;
            plugin.onerror = resolve;
            document.head.appendChild(plugin);
          } catch (e) {
            console.warn('[CIROD] Erro ao carregar plugin Chart.js:', e);
            resolve();
          }
        };
        document.head.appendChild(script);
      } catch (e) {
        console.warn('[CIROD] Erro ao iniciar carregamento Chart.js:', e);
        resolve();
      }
    });
  }

  // NÃO carregar Chart.js na inicialização - será carregado sob demanda
  const ASC_ICON_URL = "https://img.icons8.com/?size=100&id=26124&format=png&color=000000";
  const DESC_ICON_URL = "https://img.icons8.com/?size=100&id=26139&format=png&color=000000";

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
    // Carregar Chart.js sob demanda (apenas quando o módulo é acessado)
    loadChartJS();

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

    // Barra de ações
    const actionBar = document.createElement("div");
    actionBar.style.display = "flex";
    actionBar.style.gap = "10px";
    actionBar.style.marginBottom = "10px";
    actionBar.style.alignItems = "center";

    const closeButton = document.createElement("button");
    closeButton.id = "closeDentistProductivityButton";
    closeButton.textContent = "Voltar";
    closeButton.className = "btn btn-secondary";
    closeButton.addEventListener("click", closeDentistProductivityModule);
    actionBar.appendChild(closeButton);

    const recalculateButton = document.createElement("button");
    recalculateButton.textContent = "Recalcular KPIs";
    recalculateButton.className = "btn btn-warning";
    recalculateButton.title = "Recalcula todos os KPIs baseado nas requisições salvas";
    recalculateButton.addEventListener("click", async function() {
      if (!confirm("Deseja recalcular todos os KPIs?\nIsso pode demorar alguns segundos.")) {
        return;
      }
      recalculateButton.disabled = true;
      recalculateButton.textContent = "Recalculando...";
      try {
        const response = await sendServiceMessage({ command: "recalculateAllKPIs" });
        if (response.status === "success") {
          alert(`KPIs recalculados!\n${response.message}`);
          // Recarregar dados
          const spinner = document.createElement("div");
          spinner.id = "dentistsProductivitySpinner";
          spinner.textContent = "Recarregando dados...";
          spinner.style.padding = "20px";
          spinner.style.textAlign = "center";
          document.getElementById("dentistProductivityTableContainer").innerHTML = "";
          document.getElementById("dentistProductivityTableContainer").appendChild(spinner);

          const dentists = await queryDentistsProductivity();
          spinner.remove();
          productivityDentists = dentists;
          currentPage = 1;
          renderDentistTablePage(document.getElementById("dentistProductivityTableContainer"));
        } else {
          alert("Erro ao recalcular KPIs: " + (response.message || "Erro desconhecido"));
        }
      } catch (error) {
        alert("Erro ao recalcular KPIs: " + error.message);
      } finally {
        recalculateButton.disabled = false;
        recalculateButton.textContent = "Recalcular KPIs";
      }
    });
    actionBar.appendChild(recalculateButton);

    // Botão de diagnóstico
    const diagnosticButton = document.createElement("button");
    diagnosticButton.textContent = "Diagnóstico";
    diagnosticButton.className = "btn btn-info";
    diagnosticButton.title = "Mostra informações sobre dentistas e requisições no banco";
    diagnosticButton.addEventListener("click", async function() {
      diagnosticButton.disabled = true;
      diagnosticButton.textContent = "Analisando...";
      try {
        const response = await sendServiceMessage({ command: "diagnosticKPIs" });
        if (response.status === "success") {
          const d = response.data;
          showDiagnosticModal(d);
          console.log('[CIROD Diagnóstico]', d);
        } else {
          alert("Erro no diagnóstico: " + (response.message || "Erro desconhecido"));
        }
      } catch (error) {
        alert("Erro no diagnóstico: " + error.message);
      } finally {
        diagnosticButton.disabled = false;
        diagnosticButton.textContent = "Diagnóstico";
      }
    });
    actionBar.appendChild(diagnosticButton);

    container.appendChild(actionBar);

    const header = document.createElement("h2");
    header.textContent = "Produtividade dos Dentistas - CIROD";
    header.style.color = "#333";
    header.style.marginBottom = "20px";
    container.appendChild(header);

    createTabs(container);

    const tableContainer = document.createElement("div");
    tableContainer.id = "dentistProductivityTableContainer";
    container.appendChild(tableContainer);

    const spinner = document.createElement("div");
    spinner.id = "dentistsProductivitySpinner";
    spinner.textContent = "Carregando produtividade...";
    spinner.style.padding = "20px";
    spinner.style.textAlign = "center";
    container.appendChild(spinner);

    queryDentistsProductivity()
      .then((dentists) => {
        spinner.remove();
        console.log("[CIROD Produtividade] Dados carregados:", dentists.length, "dentistas");

        // Debug: Verificar estrutura de KPIs dos primeiros dentistas
        if (dentists.length > 0) {
          console.log('[CIROD Debug] Estrutura do primeiro dentista:', {
            dentist: dentists[0],
            dentist_id: dentists[0].dentist_id,
            dentist_name: dentists[0].dentist_name,
            hasKPIs: !!dentists[0].KPIs,
            KPIs: dentists[0].KPIs
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
      })
      .catch((err) => {
        spinner.textContent = "Erro ao carregar dados de produtividade.";
        console.error("[CIROD Produtividade] Erro:", err);
      });
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
      th.textContent = headerObj.label;
      th.style.padding = "8px";
      th.style.border = `1px solid ${borderColor}`;
      th.style.position = "relative";

      if (headerObj.sortable && headerObj.key) {
        th.style.cursor = "pointer";

        // Ícone de ordenação
        if (currentSort.column === headerObj.key) {
          const icon = document.createElement("img");
          icon.src = currentSort.direction === "asc" ? ASC_ICON_URL : DESC_ICON_URL;
          icon.style.width = "12px";
          icon.style.marginLeft = "5px";
          icon.style.filter = "invert(1)";
          th.appendChild(icon);
        }

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

      // Link para modal com gráfico
      const nameLink = document.createElement("a");
      nameLink.href = "#";
      nameLink.textContent = dentist.dentist_name || "Sem nome";
      nameLink.style.color = borderColor;
      nameLink.style.textDecoration = "none";
      nameLink.style.fontWeight = "500";
      nameLink.addEventListener("click", (e) => {
        e.preventDefault();
        showDentistModal(dentist);
      });
      tdName.appendChild(nameLink);
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
  function showDentistModal(dentist) {
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
    const emailStr = Array.isArray(emails) ? emails.join(", ") : (emails || "N/A");

    // Formatar telefones
    const phones = [dentist.mobile_phone, dentist.commercial_phone].filter(p => p).join(" / ") || "N/A";

    info.innerHTML = `
      <p><strong>ID:</strong> ${dentist.dentist_id || "N/A"} | <strong>CRO:</strong> ${dentist.dentist_cro || "N/A"}</p>
      <p><strong>Email:</strong> ${emailStr}</p>
      <p><strong>Telefone:</strong> ${phones}</p>
      <p><strong>Status:</strong> ${dentist.actual_partnership_status || "Não definido"}</p>
      <p><strong>Bairros:</strong> ${getNeighborhoods(dentist).join(", ") || "N/A"}</p>
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

    // Renderizar gráfico
    renderDentistChart(canvas, dentist);
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

    // Últimos 6 meses
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
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

  /**
   * Exibe modal de diagnóstico com scroll
   */
  function showDiagnosticModal(d) {
    // Remove modal existente
    const existingModal = document.getElementById("diagnosticModal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "diagnosticModal";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0,0,0,0.7)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "9999";

    const modalContent = document.createElement("div");
    modalContent.style.backgroundColor = "#1a1a2e";
    modalContent.style.color = "#e0e0e0";
    modalContent.style.padding = "20px";
    modalContent.style.borderRadius = "8px";
    modalContent.style.width = "90%";
    modalContent.style.maxWidth = "900px";
    modalContent.style.maxHeight = "85vh";
    modalContent.style.overflow = "auto";
    modalContent.style.fontFamily = "monospace";
    modalContent.style.fontSize = "13px";

    // Cabeçalho
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "20px";
    header.style.borderBottom = "1px solid #444";
    header.style.paddingBottom = "10px";

    const title = document.createElement("h3");
    title.textContent = "🔍 Diagnóstico Completo - CIROD";
    title.style.margin = "0";
    title.style.color = "#4ade80";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.fontSize = "20px";
    closeBtn.style.border = "none";
    closeBtn.style.background = "none";
    closeBtn.style.color = "#e0e0e0";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => modal.remove());
    header.appendChild(closeBtn);
    modalContent.appendChild(header);

    // Conteúdo
    const content = document.createElement("div");

    // Seção: Resumo
    content.appendChild(createSection("📊 RESUMO", `
Dentistas: ${d.totalDentists} total | ${d.dentistsWithKPIs} com KPIs | ${d.dentistsWithoutCro || 0} sem CRO
Requisições: ${d.totalRequests} total
IDs únicos de dentistas nas requisições: ${(d.uniqueRequestDentistIDs || []).length}
    `));

    // Seção: Unidades Mapeadas
    const unidadesMapeadas = typeof CIROD_UNITS !== 'undefined'
      ? CIROD_UNITS.filter(u => u.enabled !== false && u.id !== 0).map(u => `${u.name} (ID: ${u.id})`).join('\n')
      : 'N/A';
    content.appendChild(createSection("🏢 UNIDADES MAPEADAS", unidadesMapeadas));

    // Seção: Requisições por Unidade (clinic_id)
    const clinicCounts = {};
    if (d.allRequests) {
      d.allRequests.forEach(r => {
        const cid = r.clinic_id || 'null';
        clinicCounts[cid] = (clinicCounts[cid] || 0) + 1;
      });
    }
    const clinicSummary = Object.entries(clinicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cid, count]) => {
        const unit = typeof CIROD_UNITS !== 'undefined' ? CIROD_UNITS.find(u => u.id === parseInt(cid)) : null;
        const unitName = unit ? `✓ ${unit.name}` : `✗ NÃO MAPEADO`;
        return `clinic_id=${cid}: ${count} requisições → ${unitName}`;
      }).join('\n') || 'Nenhuma requisição encontrada';
    content.appendChild(createSection("🏥 REQUISIÇÕES POR UNIDADE (clinic_id)", clinicSummary));

    // Seção: Requisições por Mês
    const monthSummary = Object.entries(d.requestsByMonth || {})
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, count]) => `${month}: ${count} requisições`)
      .join('\n') || 'Nenhuma';
    content.appendChild(createSection("📅 REQUISIÇÕES POR MÊS", monthSummary));

    // Seção: Todas as Requisições
    const allReqList = (d.allRequests || [])
      .map(r => {
        const unit = typeof CIROD_UNITS !== 'undefined' ? CIROD_UNITS.find(u => u.id === r.clinic_id) : null;
        const mappedStatus = unit ? `✓ ${unit.name}` : `✗ NÃO MAPEADO`;
        const dentistInfo = r.dentist_cro ? `CRO:${r.dentist_cro}` : `ID:${r.dentist_id || 'N/A'} (sem CRO)`;
        return `ReqID:${r.id} | ${r.date || 'sem data'} | ${dentistInfo} | ${r.dentist_name || ''} | R$${r.total_value || 0} | clinic_id:${r.clinic_id} | ${mappedStatus}`;
      }).join('\n') || 'Nenhuma requisição';
    content.appendChild(createSection(`📋 TODAS AS REQUISIÇÕES (${d.totalRequests || 0})`, allReqList));

    // Seção: CROs de Dentistas
    const crosList = (d.dentistCROs || []).join(', ') || 'Nenhum';
    content.appendChild(createSection("👨‍⚕️ CROs DOS DENTISTAS CADASTRADOS", crosList));

    // Seção: CROs Órfãos
    const orphansList = (d.orphanCROs || []).join(', ') || 'Nenhum (todos têm dentista cadastrado)';
    content.appendChild(createSection("⚠️ CROs ÓRFÃOS (requisições sem dentista)", orphansList));

    modalContent.appendChild(content);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Fechar ao clicar fora
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    // Função auxiliar para criar seções
    function createSection(title, content) {
      const section = document.createElement("div");
      section.style.marginBottom = "20px";

      const sectionTitle = document.createElement("div");
      sectionTitle.textContent = title;
      sectionTitle.style.color = "#60a5fa";
      sectionTitle.style.fontWeight = "bold";
      sectionTitle.style.marginBottom = "8px";
      sectionTitle.style.fontSize = "14px";
      section.appendChild(sectionTitle);

      const sectionContent = document.createElement("pre");
      sectionContent.textContent = content;
      sectionContent.style.margin = "0";
      sectionContent.style.padding = "10px";
      sectionContent.style.backgroundColor = "#0f0f1a";
      sectionContent.style.borderRadius = "4px";
      sectionContent.style.whiteSpace = "pre-wrap";
      sectionContent.style.wordBreak = "break-word";
      sectionContent.style.maxHeight = "200px";
      sectionContent.style.overflow = "auto";
      section.appendChild(sectionContent);

      return section;
    }
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

  /**
   * Esconde o conteúdo principal do Cfaz
   * Chamado antes de exibir um módulo de controle
   */
  window.hideMainContent = function () {
    const mainContent = document.querySelector("#content > div");
    if (!mainContent) return;
    Array.from(mainContent.children).forEach((child) => {
      // Não esconder o módulo de produtividade
      if (child.id !== "dentistProductivityModule") {
        child.style.display = "none";
      }
    });
  };

  /**
   * Restaura o conteúdo principal do Cfaz
   * Chamado ao fechar um módulo de controle
   */
  window.showMainContent = function () {
    const mainContent = document.querySelector("#content > div");
    if (!mainContent) return;
    Array.from(mainContent.children).forEach((child) => {
      child.style.display = "";
    });
    // Remove o módulo de produtividade se existir
    const moduleContainer = document.getElementById("dentistProductivityModule");
    if (moduleContainer) {
      moduleContainer.remove();
    }
  };

  // ========== INICIALIZAÇÃO ==========
  // Cfaz é um SPA que usa Turbo - usar apenas turbo:load
  document.addEventListener("turbo:load", initDentistProductivityModule);
})();
