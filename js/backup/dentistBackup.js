/**
 * dentistBackup.js - Assistente CIROD
 * Backup automático de dentistas do Cfaz para DynamoDB
 */

// Cache com TTL de 5 minutos (usa CacheWithTTL do awsConfig.js)
const dentistFetchCache = new CacheWithTTL(5 * 60 * 1000, 60 * 1000);

// Variáveis de identificação
let dentist_id;
let dentistDataFromDynamoDB = null;

// Logs consolidados
let consolidatedLogs = [];
function printConsolidatedLogs() {
  if (consolidatedLogs.length > 0) {
    console.log("[CIROD] Logs consolidados:", consolidatedLogs);
    consolidatedLogs = [];
  }
}

// ========== INICIALIZAÇÃO ==========
// Cfaz é um SPA que usa Turbo - usar apenas turbo:load
document.addEventListener("turbo:load", initializeDentistScript);

/**
 * Função principal de inicialização
 */
function initializeDentistScript() {
  // Verificar se estamos em uma página de dentista específica
  const urlPath = window.location.pathname;
  const dentistPageMatch = urlPath.match(/\/usr\/dentist_data\/(\d+)$/);

  if (!dentistPageMatch) {
    // Não estamos em uma página de dentista específica
    return;
  }

  console.log("[CIROD Dentista] Página de dentista detectada:", urlPath);
  console.log("[CIROD Dentista] ID detectado na URL:", dentistPageMatch[1]);
  observeDentistId();
}

/**
 * Converte o campo "email" em array
 */
function parseEmails(emailString) {
  if (!emailString) return [];
  return emailString.split(/\s*,\s*/).filter((email) => email);
}

/**
 * Observa e detecta o ID do dentista na página
 */
function observeDentistId() {
  const checkDentistId = () => {
    const editButton = document.querySelector(
      'a[href*="/usr/dentist_data/"][href*="/edit"]'
    );
    if (editButton) {
      const href = editButton.getAttribute("href");
      const match = href.match(/\/usr\/dentist_data\/(\d+)\/edit/);
      if (match) {
        dentist_id = match[1];
        loadAndSaveDentistData(dentist_id);
        return true;
      } else {
        consolidatedLogs.push("[ERRO - observeDentistId] Não foi possível detectar o dentist_id.");
        printConsolidatedLogs();
      }
    }
    return false;
  };

  if (checkDentistId()) return;

  const observer = new MutationObserver(() => {
    if (checkDentistId()) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  checkDentistId();
}

/**
 * Carrega dados do dentista do Cfaz e salva no DynamoDB
 */
function loadAndSaveDentistData(dentist_id) {
  console.log("[CIROD Dentista] loadAndSaveDentistData iniciado para ID:", dentist_id);

  processDentistData(dentist_id)
    .then((data) => {
      if (data) {
        console.log("[CIROD Dentista] Backup concluído com sucesso:", data.dentist_name);
      } else {
        console.warn("[CIROD Dentista] Backup retornou null");
      }
    })
    .catch((error) => {
      console.error("[CIROD Dentista] Erro no backup:", error);
    });
}

/**
 * Faz fetch dos dados do dentista no Cfaz e salva no DynamoDB
 */
async function processDentistData(dentist_id) {
  console.log("[CIROD Dentista] processDentistData iniciado para ID:", dentist_id);

  if (!dentist_id) {
    console.error("[CIROD Dentista] ID do dentista inválido:", dentist_id);
    return null;
  }

  // Verificar se já processamos recentemente
  if (dentistFetchCache.has(dentist_id)) {
    console.log("[CIROD Dentista] Dentista já em cache, pulando backup");
    return dentistFetchCache.get(dentist_id);
  }

  const requestUrl = `https://max.cfaz.net/usr/dentist_data/${dentist_id}.json`;
  console.log("[CIROD Dentista] Buscando dados da API:", requestUrl);

  try {
    const response = await fetch(requestUrl, { credentials: "include" });
    console.log("[CIROD Dentista] Resposta da API - Status:", response.status);

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Resposta não é JSON. Content-Type: " + contentType);
    }

    const data = await response.json();
    console.log("[CIROD Dentista] Dados recebidos do Cfaz:", { id: data.id, name: data.name, cro: data.cro });

    if (!data || !data.id) {
      throw new Error("Dados inválidos recebidos do servidor (sem ID)");
    }

    // Mapear dados do dentista
    const mappedDentistData = {
      dentist_id: String(data.id),
      dentist_name: data.name || null,
      dentist_cro: data.cro || null,
      dentist_email: parseEmails(data.email),
      commercial_phone: data.commercial_phone || null,
      mobile_phone: data.mobile_phone || null,
      home_phone: data.home_phone || null,
      comment: data.comment || null,
      dental_clinics: data.addresses?.map((address) => ({
        clinic_id: address.id || null,
        street: address.street || null,
        number: address.number || null,
        cep: address.cep || null,
        neighborhood: address.neighborhood || null,
        city: address.city || null,
        state: address.state || null,
        created_at: address.created_at || null,
        updated_at: address.updated_at || null,
        complement: address.complement || null,
        country: address.country || "Brasil",
        description: address.description || null,
        phone: address.phone || null,
      })) || [],
    };

    console.log("[CIROD Dentista] Dados mapeados:", {
      dentist_id: mappedDentistData.dentist_id,
      dentist_name: mappedDentistData.dentist_name,
      clinics_count: mappedDentistData.dental_clinics.length
    });

    // Salvar no DynamoDB (usando sendServiceMessage do awsConfig.js)
    try {
      const saveResponse = await sendServiceMessage({
        command: "post",
        collection: "dentists",
        docId: String(dentist_id),
        data: mappedDentistData,
      });

      // Se a operação foi cancelada por navegação, retornar dados mapeados
      if (saveResponse.status === 'cancelled') {
        return mappedDentistData;
      }

      if (saveResponse.status === 'success') {
        dentistFetchCache.set(dentist_id, mappedDentistData);
        dentistDataFromDynamoDB = mappedDentistData;
        return mappedDentistData;
      } else {
        throw new Error(saveResponse.message || "Erro desconhecido ao salvar");
      }

    } catch (saveError) {
      console.error("[CIROD Dentista] Erro ao salvar no DynamoDB:", saveError.message);
      throw saveError;
    }

  } catch (error) {
    console.error("[CIROD Dentista] Erro ao processar dentista:", error.message);
    return null;
  }
}

/**
 * Atualiza campo específico do dentista no DynamoDB
 * Usa sendServiceMessage do awsConfig.js para comunicação centralizada
 */
async function updateDentistField(dentist_id, fieldPath, value) {
  const updateData = {};
  updateData[fieldPath] = value;

  try {
    const response = await sendServiceMessage({
      command: "update",
      collection: "dentists",
      docId: String(dentist_id),
      data: updateData,
    });

    // Se a operação foi cancelada por navegação, apenas retornar
    if (response.status === 'cancelled') {
      console.log("[CIROD] Atualização de campo cancelada por navegação");
      return;
    }

    console.log("[CIROD] Campo do dentista atualizado com sucesso.");
  } catch (error) {
    console.error("[CIROD] Erro ao atualizar campo do dentista:", error.message);
    throw error;
  }
}
