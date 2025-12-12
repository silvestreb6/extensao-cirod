/***************************************************************************************
 * logger.js
 *
 * Script único e global para lidar com logs consolidados em formato de tabela.
 * Todos os scripts podem usar window.AppLogger para gerar logs.
 * Os logs são impressos no console via console.table() automaticamente a cada 4s.
 ***************************************************************************************/

(function () {
  // Array interno que armazenará todos os logs
  const _internalLogs = [];

  /**
   * log(level, arg1, arg2):
   * Função interna para registrar logs.
   * Possíveis assinaturas ao chamar do lado de fora:
   *   - AppLogger.info("Minha mensagem")
   *   - AppLogger.info("nomeDoScript.js", "Minha mensagem")
   *
   * Se vierem só 2 argumentos: (level, arg1) => arg1 é a mensagem
   * Se vierem 3 argumentos: (level, arg1, arg2) => arg1 é scriptName, arg2 é mensagem
   */
  function log(level, arg1, arg2) {
    let scriptName = "";
    let message = "";

    if (arguments.length === 2) {
      // (level, arg1)
      message = arg1;
    } else {
      // (level, arg1, arg2)
      scriptName = arg1;
      message = arg2;
    }

    const timestamp = new Date().toISOString();
    _internalLogs.push({
      Timestamp: timestamp,
      Script: scriptName,
      Level: level,
      Message: message,
    });
  }

  /**
   * Métodos públicos de AppLogger
   */
  const AppLogger = {
    info(arg1, arg2) {
      log("INFO", arg1, arg2);
    },
    warn(arg1, arg2) {
      log("WARN", arg1, arg2);
    },
    error(arg1, arg2) {
      log("ERROR", arg1, arg2);
    },
    debug(arg1, arg2) {
      log("DEBUG", arg1, arg2);
    },

    /**
     * flush():
     * Imprime todos os logs acumulados usando console.table() e limpa o array.
     */
    flush() {
      if (_internalLogs.length === 0) return;
      console.group(`==== [AppLogger] ${_internalLogs.length} Log(s) ====`);
      // Cria uma cópia do array para evitar que a tabela seja afetada pela limpeza.
      const logsCopia = [..._internalLogs];
      console.table(logsCopia);
      console.groupEnd();
      _internalLogs.length = 0;
    },

    /**
     * getLogs():
     * Retorna (sem limpar) o array de logs interno.
     */
    getLogs() {
      return [..._internalLogs];
    },
  };

  // Disponibiliza globalmente
  window.AppLogger = AppLogger;

  // Flush automático a cada 4s
  setInterval(() => {
    if (_internalLogs.length > 0) {
      AppLogger.flush();
    }
  }, 4000);
})();
