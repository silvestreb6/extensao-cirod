/**
 * Service Worker - Assistente CIROD
 * Hub central para operações com DynamoDB via AWS SDK
 */

// Importar configurações
importScripts('aws/awsConfig.js');

// Variáveis globais para AWS
let dynamoDBClient = null;
let credentialsInitialized = false;

/**
 * Inicializa as credenciais do Cognito e o cliente DynamoDB
 */
async function initializeAWS() {
  console.log('[CIROD SW] ========== initializeAWS ==========');
  console.log('[CIROD SW] credentialsInitialized:', credentialsInitialized);
  console.log('[CIROD SW] dynamoDBClient existe:', !!dynamoDBClient);

  // Verificar se as credenciais ainda são válidas
  if (credentialsInitialized && dynamoDBClient && new Date() < dynamoDBClient.expiration) {
    console.log('[CIROD SW] Credenciais ainda válidas, reutilizando');
    return true;
  }

  // Reset se as credenciais expiraram
  if (dynamoDBClient && new Date() >= dynamoDBClient.expiration) {
    console.log('[CIROD SW] Credenciais expiradas, renovando...');
    credentialsInitialized = false;
    dynamoDBClient = null;
  }

  try {
    console.log('[CIROD SW] Iniciando autenticação com Cognito...');
    console.log('[CIROD SW] Region:', AWS_CONFIG.region);
    console.log('[CIROD SW] Identity Pool ID:', AWS_CONFIG.identityPoolId);

    // Obter credenciais do Cognito Identity Pool
    const cognitoUrl = `https://cognito-identity.${AWS_CONFIG.region}.amazonaws.com/`;
    console.log('[CIROD SW] Conectando ao Cognito:', cognitoUrl);

    const cognitoResponse = await fetch(cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityService.GetId'
      },
      body: JSON.stringify({
        IdentityPoolId: AWS_CONFIG.identityPoolId
      })
    });

    console.log('[CIROD SW] Cognito GetId - Response status:', cognitoResponse.status);

    if (!cognitoResponse.ok) {
      const errorBody = await cognitoResponse.text();
      console.error('[CIROD SW] ERRO Cognito GetId - Status:', cognitoResponse.status);
      console.error('[CIROD SW] ERRO Cognito GetId - Body:', errorBody);
      throw new Error(`Falha ao obter Identity ID: ${cognitoResponse.status} - ${errorBody}`);
    }

    const identityData = await cognitoResponse.json();
    const { IdentityId } = identityData;
    console.log('[CIROD SW] Identity ID obtido com sucesso:', IdentityId);

    // Obter credenciais temporárias
    const credentialsResponse = await fetch(cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityService.GetCredentialsForIdentity'
      },
      body: JSON.stringify({
        IdentityId: IdentityId
      })
    });

    console.log('[CIROD SW] Cognito GetCredentials - Response status:', credentialsResponse.status);

    if (!credentialsResponse.ok) {
      const errorBody = await credentialsResponse.text();
      console.error('[CIROD SW] ERRO Cognito GetCredentials - Status:', credentialsResponse.status);
      console.error('[CIROD SW] ERRO Cognito GetCredentials - Body:', errorBody);
      throw new Error(`Falha ao obter credenciais: ${credentialsResponse.status} - ${errorBody}`);
    }

    const credentialsData = await credentialsResponse.json();
    const { Credentials } = credentialsData;

    console.log('[CIROD SW] Credenciais obtidas com sucesso');
    console.log('[CIROD SW] AccessKeyId (primeiros 10 chars):', Credentials.AccessKeyId?.substring(0, 10) + '...');
    console.log('[CIROD SW] Expiration raw:', Credentials.Expiration);

    // Converter timestamp do Cognito (segundos desde epoch) para Date
    // O Cognito retorna o timestamp em segundos, não milissegundos
    let expirationDate;
    if (typeof Credentials.Expiration === 'number') {
      // Se for número, assumir que é timestamp em segundos
      expirationDate = new Date(Credentials.Expiration * 1000);
    } else {
      // Se for string ou outro formato, tentar parse direto
      expirationDate = new Date(Credentials.Expiration);
    }

    console.log('[CIROD SW] Expiration parsed:', expirationDate);

    // Armazenar credenciais
    dynamoDBClient = {
      accessKeyId: Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretKey,
      sessionToken: Credentials.SessionToken,
      expiration: expirationDate
    };

    credentialsInitialized = true;
    console.log('[CIROD SW] ========== AWS INICIALIZADO COM SUCESSO ==========');
    console.log('[CIROD SW] Credenciais válidas até:', dynamoDBClient.expiration);
    return true;

  } catch (error) {
    console.error('[CIROD SW] ========== ERRO NA INICIALIZAÇÃO AWS ==========');
    console.error('[CIROD SW] Erro:', error.message);
    console.error('[CIROD SW] Stack:', error.stack);
    credentialsInitialized = false;
    dynamoDBClient = null;
    return false;
  }
}

/**
 * Gera assinatura AWS Signature Version 4
 */
async function signRequest(method, url, headers, body) {
  const encoder = new TextEncoder();

  // Parse URL
  const urlObj = new URL(url);
  const host = urlObj.host;
  const path = urlObj.pathname;

  // Data atual
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Canonical request
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\nx-amz-security-token:${dynamoDBClient.sessionToken}\n`;
  const signedHeaders = 'host;x-amz-date;x-amz-security-token';

  const bodyHash = await sha256(body);
  const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

  // String to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${AWS_CONFIG.region}/dynamodb/aws4_request`;
  const canonicalRequestHash = await sha256(canonicalRequest);
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  // Signing key
  const kDate = await hmacSha256(encoder.encode('AWS4' + dynamoDBClient.secretAccessKey), dateStamp);
  const kRegion = await hmacSha256(kDate, AWS_CONFIG.region);
  const kService = await hmacSha256(kRegion, 'dynamodb');
  const kSigning = await hmacSha256(kService, 'aws4_request');

  // Signature
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Authorization header
  const authorization = `${algorithm} Credential=${dynamoDBClient.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Authorization': authorization,
    'X-Amz-Date': amzDate,
    'X-Amz-Security-Token': dynamoDBClient.sessionToken
  };
}

async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const keyData = key instanceof Uint8Array ? key : encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return new Uint8Array(signature);
}

async function hmacSha256Hex(key, message) {
  const signature = await hmacSha256(key, message);
  return Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Executa uma operação no DynamoDB
 */
async function dynamoDBOperation(operation, params) {
  console.log('[CIROD SW] ========== dynamoDBOperation ==========');
  console.log('[CIROD SW] Operação:', operation);
  console.log('[CIROD SW] Tabela:', params.TableName);

  // Verificar/renovar credenciais
  if (!credentialsInitialized || !dynamoDBClient || new Date() >= dynamoDBClient.expiration) {
    console.log('[CIROD SW] Credenciais não disponíveis, inicializando...');
    const initialized = await initializeAWS();
    if (!initialized) {
      console.error('[CIROD SW] FALHA ao inicializar AWS - operação cancelada');
      throw new Error('Falha ao inicializar credenciais AWS. Verifique o Identity Pool e as permissões.');
    }
  } else {
    console.log('[CIROD SW] Credenciais OK, válidas até:', dynamoDBClient.expiration);
  }

  const url = `https://dynamodb.${AWS_CONFIG.region}.amazonaws.com/`;
  const body = JSON.stringify(params);

  console.log('[CIROD SW] URL DynamoDB:', url);
  console.log('[CIROD SW] Body size:', body.length, 'bytes');
  console.log('[CIROD SW] Request Body:', body);

  const baseHeaders = {
    'Content-Type': 'application/x-amz-json-1.0',
    'X-Amz-Target': `DynamoDB_20120810.${operation}`
  };

  try {
    const signedHeaders = await signRequest('POST', url, baseHeaders, body);
    console.log('[CIROD SW] Headers assinados gerados');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        ...signedHeaders
      },
      body: body
    });

    console.log('[CIROD SW] DynamoDB Response Status:', response.status);
    const responseText = await response.text();
    console.log('[CIROD SW] DynamoDB Response Body:', responseText);

    if (!response.ok) {
      console.error('[CIROD SW] ERRO DynamoDB - Status:', response.status);
      console.error('[CIROD SW] ERRO DynamoDB - Body:', responseText);
      throw new Error(`DynamoDB Error (${response.status}): ${responseText}`);
    }

    // Tentar parsear como JSON se houver conteúdo
    let result = {};
    if (responseText && responseText.trim()) {
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.log('[CIROD SW] Resposta não é JSON (normal para PutItem)');
      }
    }

    console.log('[CIROD SW] Operação', operation, 'concluída com sucesso');
    return result;

  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      console.error('[CIROD] Erro de conexão - Possíveis causas:');
      console.error('  1. Sem conexão com a internet');
      console.error('  2. AWS não acessível');
      console.error('  3. Credenciais inválidas ou expiradas');
      throw new Error('Falha na conexão com AWS. Verifique sua conexão e as credenciais.');
    }
    throw error;
  }
}

/**
 * Converte objeto JavaScript para formato DynamoDB
 */
function toDynamoDB(obj) {
  if (obj === null || obj === undefined) return { NULL: true };
  if (typeof obj === 'string') return { S: obj };
  if (typeof obj === 'number') return { N: obj.toString() };
  if (typeof obj === 'boolean') return { BOOL: obj };
  if (Array.isArray(obj)) return { L: obj.map(toDynamoDB) };
  if (typeof obj === 'object') {
    const mapped = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        mapped[key] = toDynamoDB(value);
      }
    }
    return { M: mapped };
  }
  return { S: String(obj) };
}

/**
 * Converte formato DynamoDB para objeto JavaScript
 */
function fromDynamoDB(item) {
  if (!item) return null;

  if (item.S !== undefined) return item.S;
  if (item.N !== undefined) return parseFloat(item.N);
  if (item.BOOL !== undefined) return item.BOOL;
  if (item.NULL !== undefined) return null;
  if (item.L !== undefined) return item.L.map(fromDynamoDB);
  if (item.M !== undefined) {
    const obj = {};
    for (const [key, value] of Object.entries(item.M)) {
      obj[key] = fromDynamoDB(value);
    }
    return obj;
  }

  // Se for um objeto direto (resultado de GetItem/Scan)
  if (typeof item === 'object' && !item.S && !item.N && !item.BOOL && !item.L && !item.M) {
    const obj = {};
    for (const [key, value] of Object.entries(item)) {
      obj[key] = fromDynamoDB(value);
    }
    return obj;
  }

  return item;
}

/**
 * Listener de mensagens do content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.command) {
    sendResponse({ status: 'error', message: 'Comando não especificado.' });
    return false;
  }

  console.log('[CIROD] Comando recebido:', message.command);

  // Processar comandos assíncronos com Promise wrapper para garantir resposta
  const handleMessage = async () => {
    try {
      let result;

      switch (message.command) {
        case 'get':
          result = await handleGet(message);
          break;
        case 'put':
        case 'post':
          result = await handlePut(message);
          break;
        case 'update':
          result = await handleUpdate(message);
          break;
        case 'scan':
          result = await handleScan(message);
          break;
        case 'query':
          result = await handleQuery(message);
          break;
        case 'scanDentistsKPIs':
          result = await handleScanDentistsKPIs();
          break;
        case 'queryByDentistCro':
          result = await handleQueryByDentistCro(message);
          break;
        case 'queryByDentistId':
          result = await handleQueryByDentistId(message);
          break;
        case 'recalculateAllKPIs':
          result = await handleRecalculateAllKPIs();
          break;
        case 'diagnosticKPIs':
          result = await handleDiagnosticKPIs();
          break;
        default:
          result = { status: 'error', message: `Comando desconhecido: ${message.command}` };
      }

      console.log('[CIROD] Comando', message.command, 'processado com status:', result?.status);
      return result;
    } catch (error) {
      console.error('[CIROD] Erro no comando:', message.command, error);
      return { status: 'error', message: error.message || 'Erro desconhecido' };
    }
  };

  // Executar e enviar resposta
  handleMessage()
    .then(result => {
      try {
        sendResponse(result);
      } catch (e) {
        console.error('[CIROD] Erro ao enviar resposta:', e);
      }
    })
    .catch(error => {
      console.error('[CIROD] Erro fatal:', error);
      try {
        sendResponse({ status: 'error', message: error.message || 'Erro fatal' });
      } catch (e) {
        console.error('[CIROD] Não foi possível enviar resposta de erro:', e);
      }
    });

  return true; // Indica resposta assíncrona
});

/**
 * GET - Buscar documento por ID
 */
async function handleGet(message) {
  const { collection, docId } = message;

  if (!collection || !docId) {
    return { status: 'error', message: 'collection e docId são obrigatórios' };
  }

  const tableName = AWS_CONFIG.tables[collection] || collection;
  const keyName = collection === 'dentists' ? 'dentist_id' : 'request_id';

  const params = {
    TableName: tableName,
    Key: {
      [keyName]: { S: String(docId) }
    }
  };

  const result = await dynamoDBOperation('GetItem', params);

  if (result.Item) {
    return { status: 'success', data: fromDynamoDB(result.Item) };
  } else {
    return { status: 'not_found', message: 'Documento não encontrado.' };
  }
}

/**
 * PUT/POST - Criar ou atualizar documento
 */
async function handlePut(message) {
  const { collection, docId, data } = message;

  console.log('[CIROD SW] handlePut iniciado:', { collection, docId, dataKeys: data ? Object.keys(data) : null });

  if (!collection || !docId || !data) {
    console.error('[CIROD SW] handlePut: parâmetros faltando', { collection, docId, hasData: !!data });
    return { status: 'error', message: 'collection, docId e data são obrigatórios' };
  }

  const tableName = AWS_CONFIG.tables[collection] || collection;
  const keyName = collection === 'dentists' ? 'dentist_id' : 'request_id';

  console.log('[CIROD SW] handlePut: tabela=', tableName, 'keyName=', keyName);

  // Adicionar a chave primária aos dados
  const itemData = { ...data, [keyName]: docId };

  // Converter para formato DynamoDB
  const item = {};
  for (const [key, value] of Object.entries(itemData)) {
    if (value !== undefined) {
      item[key] = toDynamoDB(value);
    }
  }

  const params = {
    TableName: tableName,
    Item: item
  };

  await dynamoDBOperation('PutItem', params);
  return { status: 'success', message: 'Documento salvo com sucesso.' };
}

/**
 * UPDATE - Atualizar campos específicos
 */
async function handleUpdate(message) {
  const { collection, docId, data } = message;

  if (!collection || !docId || !data) {
    return { status: 'error', message: 'collection, docId e data são obrigatórios' };
  }

  const tableName = AWS_CONFIG.tables[collection] || collection;
  const keyName = collection === 'dentists' ? 'dentist_id' : 'request_id';

  // Construir expressão de atualização
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    if (key !== keyName) {
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      updateExpressions.push(`${attrName} = ${attrValue}`);
      expressionAttributeNames[attrName] = key;
      expressionAttributeValues[attrValue] = toDynamoDB(value);
      index++;
    }
  }

  if (updateExpressions.length === 0) {
    return { status: 'error', message: 'Nenhum campo para atualizar.' };
  }

  const params = {
    TableName: tableName,
    Key: {
      [keyName]: { S: String(docId) }
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  };

  await dynamoDBOperation('UpdateItem', params);
  return { status: 'success', message: 'Documento atualizado com sucesso.' };
}

/**
 * SCAN - Listar todos os documentos
 */
async function handleScan(message) {
  const { collection } = message;

  if (!collection) {
    return { status: 'error', message: 'collection é obrigatório' };
  }

  const tableName = AWS_CONFIG.tables[collection] || collection;

  const params = {
    TableName: tableName
  };

  const result = await dynamoDBOperation('Scan', params);
  const items = (result.Items || []).map(item => fromDynamoDB(item));
  return { status: 'success', data: items };
}

/**
 * QUERY - Buscar com filtros
 */
async function handleQuery(message) {
  const { collection, filters } = message;

  if (!collection) {
    return { status: 'error', message: 'collection é obrigatório' };
  }

  // Para queries simples, usar Scan com FilterExpression
  const tableName = AWS_CONFIG.tables[collection] || collection;

  const params = {
    TableName: tableName
  };

  // Adicionar filtros se existirem
  if (filters && filters.length > 0) {
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    filters.forEach((filter, index) => {
      const attrName = `#f${index}`;
      const attrValue = `:v${index}`;
      expressionAttributeNames[attrName] = filter.field;
      // Converter valor para formato DynamoDB (string simples)
      expressionAttributeValues[attrValue] = { S: String(filter.value) };
      filterExpressions.push(`${attrName} ${filter.operator} ${attrValue}`);
    });

    params.FilterExpression = filterExpressions.join(' AND ');
    params.ExpressionAttributeNames = expressionAttributeNames;
    params.ExpressionAttributeValues = expressionAttributeValues;

    console.log('[CIROD] Query com filtros:', { filters, params });
  }

  const result = await dynamoDBOperation('Scan', params);
  const items = (result.Items || []).map(item => fromDynamoDB(item));

  console.log('[CIROD] Query result:', { collection, filterCount: filters?.length || 0, resultCount: items.length, items: items.slice(0, 2) });

  return { status: 'success', data: items };
}

/**
 * Scan específico para KPIs de dentistas (otimizado)
 */
async function handleScanDentistsKPIs() {
  // Usar ExpressionAttributeNames para campos que podem ter nomes reservados
  const params = {
    TableName: AWS_CONFIG.tables.dentists,
    ProjectionExpression: '#did, #dname, #dcro, #demail, #mphone, #cphone, #dclinics, #kpis, #pstatus',
    ExpressionAttributeNames: {
      '#did': 'dentist_id',
      '#dname': 'dentist_name',
      '#dcro': 'dentist_cro',
      '#demail': 'dentist_email',
      '#mphone': 'mobile_phone',
      '#cphone': 'commercial_phone',
      '#dclinics': 'dental_clinics',
      '#kpis': 'KPIs',
      '#pstatus': 'actual_partnership_status'
    }
  };

  const result = await dynamoDBOperation('Scan', params);

  console.log('[CIROD] scanDentistsKPIs - Raw items count:', result.Items?.length || 0);

  const items = (result.Items || []).map(item => {
    const converted = fromDynamoDB(item);
    return {
      id: converted.dentist_id,
      ...converted
    };
  });

  // Log de exemplo para verificar KPIs
  if (items.length > 0) {
    const sample = items[0];
    console.log('[CIROD] scanDentistsKPIs - Sample dentist:', {
      dentist_id: sample.dentist_id,
      dentist_name: sample.dentist_name,
      hasKPIs: !!sample.KPIs,
      KPIs: sample.KPIs
    });
  }

  return { status: 'success', data: items };
}

/**
 * Query requisições por CRO do dentista (para cálculo de KPIs)
 */
async function handleQueryByDentistCro(message) {
  const { cro } = message;

  if (!cro) {
    return { status: 'error', message: 'CRO é obrigatório' };
  }

  const params = {
    TableName: AWS_CONFIG.tables.requests,
    FilterExpression: '#dentist.#cro = :cro',
    ExpressionAttributeNames: {
      '#dentist': 'dentist',
      '#cro': 'dentist_cro'
    },
    ExpressionAttributeValues: {
      ':cro': { S: cro }
    }
  };

  try {
    const result = await dynamoDBOperation('Scan', params);
    const items = (result.Items || []).map(item => fromDynamoDB(item));

    return { status: 'success', data: items };
  } catch (error) {
    console.error('[CIROD] Erro ao buscar requisições por CRO:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Query requisições por ID do dentista (fallback quando CRO não existe)
 */
async function handleQueryByDentistId(message) {
  const { dentistId } = message;

  if (!dentistId) {
    return { status: 'error', message: 'dentistId é obrigatório' };
  }

  const params = {
    TableName: AWS_CONFIG.tables.requests,
    FilterExpression: '#dentist.#did = :did',
    ExpressionAttributeNames: {
      '#dentist': 'dentist',
      '#did': 'dentist_id'
    },
    ExpressionAttributeValues: {
      ':did': { N: String(dentistId) }
    }
  };

  try {
    const result = await dynamoDBOperation('Scan', params);
    const items = (result.Items || []).map(item => fromDynamoDB(item));

    return { status: 'success', data: items };
  } catch (error) {
    console.error('[CIROD] Erro ao buscar requisições por dentist_id:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Diagnóstico de KPIs - retorna informações sobre o estado atual dos dados
 */
async function handleDiagnosticKPIs() {
  console.log('[CIROD] Executando diagnóstico de KPIs...');

  try {
    // 1. Buscar todas as requisições
    const requestsResult = await dynamoDBOperation('Scan', {
      TableName: AWS_CONFIG.tables.requests
    });
    const requests = (requestsResult.Items || []).map(item => fromDynamoDB(item));

    // 2. Buscar todos os dentistas
    const dentistsResult = await dynamoDBOperation('Scan', {
      TableName: AWS_CONFIG.tables.dentists
    });
    const dentists = (dentistsResult.Items || []).map(item => fromDynamoDB(item));

    // 3. Analisar dados
    const dentistsWithKPIs = dentists.filter(d => d.KPIs && Object.keys(d.KPIs.periodKPIs || {}).length > 0);
    const dentistCROs = dentists.map(d => d.dentist_cro).filter(Boolean);
    const requestCROs = [...new Set(requests.map(r => r.dentist?.dentist_cro).filter(Boolean))];

    // CROs em requisições que não têm dentista cadastrado
    const orphanCROs = requestCROs.filter(cro => !dentistCROs.includes(cro));

    // CROs de dentistas que têm requisições
    const dentistsWithRequests = dentistCROs.filter(cro => requestCROs.includes(cro));

    // Agrupar requisições por mês
    const requestsByMonth = {};
    requests.forEach(req => {
      if (req.creation_date_inv) {
        const [year, month] = req.creation_date_inv.split('-');
        const key = `${year}-${month}`;
        requestsByMonth[key] = (requestsByMonth[key] || 0) + 1;
      }
    });

    // Log detalhado de cada requisição para debug
    console.log('[CIROD] ===== ANÁLISE DETALHADA DE REQUISIÇÕES =====');
    requests.forEach((req, idx) => {
      const clinicId = req.clinic?.id;
      const clinicName = req.clinic?.name;
      const unit = typeof CIROD_UNITS !== 'undefined' ? CIROD_UNITS.find(u => u.id === clinicId) : null;
      console.log(`[CIROD] Req #${idx + 1}: ID=${req.request_id} | clinic.id=${clinicId} | clinic.name="${clinicName}" | Mapeado: ${unit ? unit.name : 'NÃO'}`);
    });
    console.log('[CIROD] ===== FIM DA ANÁLISE =====');

    // Retornar TODAS as requisições para o modal
    const allRequests = requests.map(r => ({
      id: r.request_id,
      date: r.creation_date_inv,
      dentist_cro: r.dentist?.dentist_cro,
      dentist_id: r.dentist?.dentist_id,
      dentist_name: r.dentist?.dentist_name,
      total_value: r.total_value,
      clinic_id: r.clinic?.id,
      clinic_name: r.clinic?.name
    }));

    // Contar dentistas sem CRO
    const dentistsWithoutCro = dentists.filter(d => !d.dentist_cro);
    const dentistIDs = dentists.map(d => String(d.dentist_id)).filter(Boolean);
    const requestDentistIDs = [...new Set(requests.map(r => String(r.dentist?.dentist_id)).filter(Boolean))];

    const diagnostic = {
      totalDentists: dentists.length,
      dentistsWithKPIs: dentistsWithKPIs.length,
      dentistsWithoutCro: dentistsWithoutCro.length,
      dentistCROs: dentistCROs,
      dentistIDs: dentistIDs,
      totalRequests: requests.length,
      uniqueRequestCROs: requestCROs,
      uniqueRequestDentistIDs: requestDentistIDs,
      orphanCROs: orphanCROs,
      dentistsWithRequests: dentistsWithRequests,
      requestsByMonth: requestsByMonth,
      allRequests: allRequests,
      sampleRequests: allRequests.slice(0, 5)
    };

    console.log('[CIROD] Diagnóstico resumo:', {
      totalDentists: diagnostic.totalDentists,
      totalRequests: diagnostic.totalRequests,
      requestsByMonth: diagnostic.requestsByMonth
    });

    return {
      status: 'success',
      data: diagnostic
    };

  } catch (error) {
    console.error('[CIROD] Erro no diagnóstico:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Recalcula todos os KPIs baseado nas requisições existentes
 * Esta função busca todas as requisições e recalcula os KPIs de cada dentista
 */
async function handleRecalculateAllKPIs() {
  console.log('[CIROD] Iniciando recálculo de todos os KPIs...');
  console.log('[CIROD] CIROD_UNITS disponível:', typeof CIROD_UNITS !== 'undefined');
  if (typeof CIROD_UNITS !== 'undefined') {
    console.log('[CIROD] Unidades habilitadas:', CIROD_UNITS.filter(u => u.enabled !== false).map(u => `${u.name}(${u.id})`).join(', '));
  }

  try {
    // 1. Buscar todas as requisições
    const requestsResult = await dynamoDBOperation('Scan', {
      TableName: AWS_CONFIG.tables.requests
    });
    const requests = (requestsResult.Items || []).map(item => fromDynamoDB(item));
    console.log(`[CIROD] Encontradas ${requests.length} requisições`);

    // Log detalhado de clinic_id de cada requisição
    console.log('[CIROD] ===== DETALHES DE CLINIC_ID =====');
    const clinicIdCounts = {};
    requests.forEach(req => {
      const cid = req.clinic?.id;
      clinicIdCounts[cid || 'undefined'] = (clinicIdCounts[cid || 'undefined'] || 0) + 1;
    });
    console.log('[CIROD] Contagem por clinic_id:', JSON.stringify(clinicIdCounts));
    console.log('[CIROD] ===== FIM DETALHES =====');

    // 2. Buscar todos os dentistas
    const dentistsResult = await dynamoDBOperation('Scan', {
      TableName: AWS_CONFIG.tables.dentists
    });
    const dentists = (dentistsResult.Items || []).map(item => fromDynamoDB(item));
    console.log(`[CIROD] Encontrados ${dentists.length} dentistas`);

    // 3. Criar mapas de dentistas por CRO e por ID
    // Nota: String vazia "" é tratada como falsy, então dentistas sem CRO não entram no mapa por CRO
    const dentistsByCro = {};
    const dentistsById = {};
    let dentistsWithCro = 0;
    let dentistsWithoutCro = 0;
    dentists.forEach(d => {
      // Apenas adicionar ao mapa se CRO não for vazio
      if (d.dentist_cro && d.dentist_cro.trim() !== '') {
        dentistsByCro[d.dentist_cro] = d;
        dentistsWithCro++;
      } else {
        dentistsWithoutCro++;
      }
      if (d.dentist_id) {
        dentistsById[String(d.dentist_id)] = d;
      }
    });
    console.log(`[CIROD] Dentistas: ${dentistsWithCro} com CRO, ${dentistsWithoutCro} sem CRO`);

    console.log(`[CIROD] Mapa de dentistas: ${Object.keys(dentistsByCro).length} por CRO, ${Object.keys(dentistsById).length} por ID`);

    // 4. Agrupar requisições por dentista (usando dentist_id como chave principal)
    // Isso permite processar mesmo dentistas sem CRO
    const kpisByDentistId = {};

    requests.forEach(req => {
      // Tratar string vazia como null para CRO
      const cro = req.dentist?.dentist_cro || null;
      const dentistId = req.dentist?.dentist_id;

      // Precisamos de pelo menos uma data válida
      if (!req.creation_date_inv) return;

      // Tentar encontrar o dentista por CRO ou por ID
      let dentist = null;
      let dentistIdKey = null;

      if (cro && dentistsByCro[cro]) {
        dentist = dentistsByCro[cro];
        dentistIdKey = String(dentist.dentist_id);
      } else if (dentistId && dentistsById[String(dentistId)]) {
        dentist = dentistsById[String(dentistId)];
        dentistIdKey = String(dentistId);
      }

      // Se não encontrou o dentista, criar automaticamente usando dados do request
      if (!dentist && dentistId) {
        console.log(`[CIROD] Dentista não encontrado (CRO: ${cro || 'vazio'}, ID: ${dentistId}), será criado automaticamente`);

        // Criar novo dentista com dados do request
        const newDentist = {
          dentist_id: String(dentistId),
          dentist_name: req.dentist?.dentist_name || "Nome não informado",
          dentist_cro: cro || null,
          dentist_email: req.dentist?.dentist_email || [],
          commercial_phone: req.dentist?.commercial_phone || null,
          mobile_phone: req.dentist?.mobile_phone || null,
          home_phone: req.dentist?.home_phone || null,
          comment: req.dentist?.comment || null,
          dental_clinics: req.dentist?.dental_clinics || [],
          actual_partnership_status: "Parceria em teste",
          KPIs: {
            expectedMonthlyRevenue: 0,
            expectedMonthlyQtd: 0,
            periodKPIs: {}
          },
          created_at: new Date().toISOString(),
          auto_created: true
        };

        // Adicionar ao mapa para processamento
        dentistsById[String(dentistId)] = newDentist;
        if (cro && cro.trim() !== '') {
          dentistsByCro[cro] = newDentist;
        }

        dentist = newDentist;
        dentistIdKey = String(dentistId);
        console.log(`[CIROD] Dentista ${newDentist.dentist_name} (ID: ${dentistId}) preparado para criação`);
      }

      // Se ainda não encontrou o dentista (sem ID), ignorar
      if (!dentist || !dentistIdKey) {
        console.log(`[CIROD] Requisição ${req.request_id} sem dados suficientes para criar dentista`);
        return;
      }

      const [year, month] = req.creation_date_inv.split('-');
      if (!year || !month) return;

      const totalValue = parseFloat(req.total_value) || 0;
      const clinicId = req.clinic?.id;

      if (!kpisByDentistId[dentistIdKey]) {
        kpisByDentistId[dentistIdKey] = {
          dentist: dentist,
          kpis: {
            expectedMonthlyRevenue: 0,
            expectedMonthlyQtd: 0,
            periodKPIs: {}
          }
        };
      }

      const kpis = kpisByDentistId[dentistIdKey].kpis;

      // Garantir estrutura do período
      if (!kpis.periodKPIs[year]) {
        kpis.periodKPIs[year] = {};
      }
      if (!kpis.periodKPIs[year][month]) {
        kpis.periodKPIs[year][month] = createEmptyMonthKPIs();
      }

      const monthKPIs = kpis.periodKPIs[year][month];

      // Atualizar totais
      monthKPIs.faturamentoTotalMes = (monthKPIs.faturamentoTotalMes || 0) + totalValue;
      monthKPIs.totalPedidos = (monthKPIs.totalPedidos || 0) + 1;

      // Atualizar por unidade
      if (clinicId && typeof CIROD_UNITS !== 'undefined') {
        const unit = CIROD_UNITS.find(u => u.id === clinicId && u.enabled !== false);
        if (unit) {
          const faturamentoField = `faturamento${unit.fieldSuffix}`;
          const pedidosField = `totalPedidos${unit.fieldSuffix}`;
          monthKPIs[faturamentoField] = (monthKPIs[faturamentoField] || 0) + totalValue;
          monthKPIs[pedidosField] = (monthKPIs[pedidosField] || 0) + 1;
          console.log(`[CIROD] KPI por unidade: clinicId=${clinicId} -> ${unit.name} (${faturamentoField}): +R$${totalValue}`);
        } else {
          console.log(`[CIROD] Unidade não mapeada: clinicId=${clinicId} (valor: R$${totalValue})`);
        }
      }
    });

    // 5. Calcular ticket médio e expectativas para cada dentista
    for (const dentistIdKey in kpisByDentistId) {
      const { kpis } = kpisByDentistId[dentistIdKey];

      // Calcular ticket médio
      Object.values(kpis.periodKPIs).forEach(yearData => {
        Object.values(yearData).forEach(monthData => {
          if (monthData.totalPedidos > 0) {
            monthData.avgTicket = Math.round(monthData.faturamentoTotalMes / monthData.totalPedidos * 100) / 100;
          }
        });
      });

      // Calcular expectativas
      const monthlyRevenues = [];
      const monthlyQuantities = [];

      Object.values(kpis.periodKPIs).forEach(yearData => {
        Object.values(yearData).forEach(monthData => {
          if (monthData.faturamentoTotalMes > 500) {
            monthlyRevenues.push(monthData.faturamentoTotalMes);
          }
          if (monthData.totalPedidos >= 4) {
            monthlyQuantities.push(monthData.totalPedidos);
          }
        });
      });

      if (monthlyRevenues.length > 0) {
        kpis.expectedMonthlyRevenue = Math.round(
          monthlyRevenues.reduce((a, b) => a + b, 0) / monthlyRevenues.length * 100
        ) / 100;
      }

      if (monthlyQuantities.length > 0) {
        kpis.expectedMonthlyQtd = Math.round(
          monthlyQuantities.reduce((a, b) => a + b, 0) / monthlyQuantities.length * 10
        ) / 10;
      }
    }

    // 6. Atualizar KPIs de cada dentista no DynamoDB
    let updatedCount = 0;
    for (const dentistIdKey in kpisByDentistId) {
      const { dentist, kpis } = kpisByDentistId[dentistIdKey];

      // Converter para formato DynamoDB
      const item = {};
      for (const [key, value] of Object.entries({ ...dentist, KPIs: kpis })) {
        if (value !== undefined) {
          item[key] = toDynamoDB(value);
        }
      }

      await dynamoDBOperation('PutItem', {
        TableName: AWS_CONFIG.tables.dentists,
        Item: item
      });

      updatedCount++;
      const identifier = dentist.dentist_cro || `ID:${dentist.dentist_id}`;
      console.log(`[CIROD] KPIs atualizados para dentista: ${identifier}`);
    }

    console.log(`[CIROD] Recálculo concluído: ${updatedCount} dentistas atualizados`);
    return {
      status: 'success',
      message: `KPIs recalculados para ${updatedCount} dentistas baseado em ${requests.length} requisições`,
      data: { dentistsUpdated: updatedCount, requestsProcessed: requests.length }
    };

  } catch (error) {
    console.error('[CIROD] Erro ao recalcular KPIs:', error);
    return { status: 'error', message: error.message };
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

  // Adicionar campos para cada unidade CIROD
  if (typeof CIROD_UNITS !== 'undefined') {
    CIROD_UNITS.forEach(unit => {
      emptyKPIs[`faturamento${unit.fieldSuffix}`] = 0;
      emptyKPIs[`totalPedidos${unit.fieldSuffix}`] = 0;
    });
  }

  return emptyKPIs;
}

// Inicializar AWS ao carregar o service worker
initializeAWS().then(success => {
  if (success) {
    console.log('[CIROD] Service Worker inicializado com sucesso');
  }
});
