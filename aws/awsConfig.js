// Configuração AWS para a extensão CIROD
const AWS_CONFIG = {
  region: 'us-east-1',
  identityPoolId: 'us-east-1:0b657719-1d23-4189-9d0c-d4e8c3761865',
  tables: {
    dentists: 'cirod_dentists',
    requests: 'cirod_requests'
  }
};

// Unidades da CIROD para mapeamento de KPIs
// ID corresponde ao clinic.id do Cfaz
// ID 0 = Geral (agregado de todas as unidades)
// enabled: true = ID do Cfaz confirmado, false = ainda não mapeado
const CIROD_UNITS = [
  { id: 0, city: null, name: 'Geral', fieldSuffix: 'TotalMes', color: '#333', enabled: true },
  { id: 5778, city: 'Niterói', name: 'Icaraí', fieldSuffix: 'Icarai', color: '#1565c0', enabled: true },
  { id: 1754, city: 'Maricá', name: 'Maricá', fieldSuffix: 'Marica', color: '#e65100', enabled: true },
  { id: 5543, city: 'Niterói', name: 'Niterói', fieldSuffix: 'Niteroi', color: '#1e88e5', enabled: true },
  { id: 2950, city: 'Maricá', name: 'Itaipuaçu', fieldSuffix: 'Itaipuacu', color: '#ef6c00', enabled: true },
  { id: 5189, city: 'Itaboraí', name: 'Itaboraí', fieldSuffix: 'Itaborai', color: '#7b1fa2', enabled: true },
  // Unidades ainda não mapeadas (IDs provisórios negativos)
  { id: -1, city: 'São Gonçalo', name: 'São Gonçalo', fieldSuffix: 'SaoGoncalo', color: '#1a5f1a', enabled: false },
  { id: -2, city: 'São Gonçalo', name: 'Alcântara', fieldSuffix: 'Alcantara', color: '#2e7d32', enabled: false },
  { id: -3, city: 'São Gonçalo', name: 'Raul Veiga', fieldSuffix: 'RaulVeiga', color: '#388e3c', enabled: false },
  { id: -4, city: 'São Gonçalo', name: 'Parque das Águas', fieldSuffix: 'ParqueAguas', color: '#43a047', enabled: false },
  { id: -5, city: 'Niterói', name: 'Jardim Icaraí', fieldSuffix: 'JardimIcarai', color: '#1976d2', enabled: false },
  { id: -6, city: 'Niterói', name: 'Centro Niterói', fieldSuffix: 'CentroNiteroi', color: '#1976d2', enabled: false },
  { id: -7, city: 'Niterói', name: 'Itaipú', fieldSuffix: 'Itaipu', color: '#2196f3', enabled: false },
  { id: -8, city: 'Niterói', name: 'Fonseca', fieldSuffix: 'Fonseca', color: '#42a5f5', enabled: false },
  { id: -9, city: 'Rio de Janeiro', name: 'Centro do Rio', fieldSuffix: 'CentroRio', color: '#c62828', enabled: false }
];

// Status de parceria disponíveis (com cores para UI)
const PARTNERSHIP_STATUS_OPTIONS = [
  { text: 'Parceria exclusiva', tooltip: 'parceria com mais de um ano e exclusiva', color: '#1b5e20', bgColor: '#e8f5e9' },
  { text: 'Parceria em consolidação', tooltip: 'de a partir de 6 indicações', color: '#2e7d32', bgColor: '#c8e6c9' },
  { text: 'Parceria em teste', tooltip: 'de 1 a 5 indicações', color: '#558b2f', bgColor: '#dcedc8' },
  { text: 'Oportunidade de prospecção', tooltip: 'dentista potencial ainda não prospectado', color: '#1565c0', bgColor: '#e3f2fd' },
  { text: 'Fragilidade detectada', tooltip: 'algum problema foi detectado na parceria', color: '#e65100', bgColor: '#fff3e0' },
  { text: 'Parceria perdida', tooltip: 'problema grave detectado. Redução do volume de indicação a 0', color: '#c62828', bgColor: '#ffebee' },
  { text: 'Prospecção em andamento', tooltip: 'prospecção iniciada mas o dentista ainda não fez a primeira indicação', color: '#0277bd', bgColor: '#e1f5fe' }
];

// Senhas de acesso
const ACCESS_PASSWORDS = ['111112', '110409'];

/**
 * Classe de cache com TTL (Time To Live)
 * Limpa automaticamente entradas expiradas
 */
class CacheWithTTL {
  /**
   * @param {number} ttlMs - Tempo de vida em milissegundos (padrão: 5 minutos)
   * @param {number} cleanupIntervalMs - Intervalo de limpeza em ms (padrão: 1 minuto)
   */
  constructor(ttlMs = 5 * 60 * 1000, cleanupIntervalMs = 60 * 1000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  /**
   * Armazena um valor no cache
   * @param {string} key - Chave do cache
   * @param {*} value - Valor a ser armazenado
   */
  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs
    });
  }

  /**
   * Obtém um valor do cache
   * @param {string} key - Chave do cache
   * @returns {*} Valor ou undefined se não existir/expirado
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Verifica se uma chave existe e não expirou
   * @param {string} key - Chave do cache
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove uma chave do cache
   * @param {string} key - Chave do cache
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Limpa entradas expiradas
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Limpa todo o cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Retorna o número de entradas no cache
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Para o intervalo de limpeza automática
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}

/**
 * Wrapper para comunicação com o service worker via chrome.runtime.sendMessage
 * Centraliza tratamento de erros e retorna Promise para facilitar uso com async/await
 * @param {Object} message - Mensagem a ser enviada ao service worker
 * @returns {Promise<Object>} - Resposta do service worker
 */
function sendServiceMessage(message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return reject(new Error('chrome.runtime não disponível'));
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Tratar erro de canal fechado (comum em navegação SPA)
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || 'Erro desconhecido';
          // Ignorar silenciosamente erros de canal fechado durante navegação
          if (errorMsg.includes('message channel closed') || errorMsg.includes('Receiving end does not exist')) {
            console.log('[CIROD] Canal de mensagem fechado durante navegação - ignorando');
            return resolve({ status: 'cancelled', message: 'Operação cancelada por navegação' });
          }
          return reject(new Error(errorMsg));
        }
        if (response && response.status === 'success') {
          resolve(response);
        } else if (response && response.status === 'cancelled') {
          resolve(response); // Não é erro, apenas operação cancelada
        } else if (response && response.status === 'not_found') {
          resolve(response); // Não é erro, documento simplesmente não existe
        } else {
          reject(new Error(response?.message || 'Erro na comunicação com service worker'));
        }
      });
    } catch (e) {
      // Capturar exceções síncronas (raro, mas possível em alguns cenários)
      if (e.message && (e.message.includes('Extension context invalidated') || e.message.includes('message channel closed'))) {
        console.log('[CIROD] Contexto da extensão invalidado - ignorando');
        return resolve({ status: 'cancelled', message: 'Contexto invalidado' });
      }
      reject(e);
    }
  });
}
