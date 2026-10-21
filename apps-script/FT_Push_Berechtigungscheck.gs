/**
 * FireTime Pro – einmalige, ungefährliche Berechtigungsprüfung.
 * In Apps Script als neue Datei FT_Push_Berechtigungscheck.gs einfügen.
 * Diese Funktion verändert keine Daten, Eigenschaften oder Trigger.
 * Developed by Michael Mejtsky
 */
function ftPushBerechtigungenPruefen() {
  const properties = PropertiesService.getScriptProperties();
  const gateway = 'https://firetime-pro-api.firetime-pro.workers.dev';
  const existing = String(properties.getProperty('FT_PUSH_WORKER_URL') || '');
  const hasGatewayKey = Boolean(properties.getProperty('FT_GATEWAY_KEY'));
  const hasDatabase = Boolean(properties.getProperty('FT_DB_ID'));
  const result = {
    version: typeof FT_VERSION === 'string' ? FT_VERSION : 'unbekannt',
    pushWorkerUrl: existing || 'FEHLT',
    pushWorkerUrlCorrect: existing.replace(/\/$/, '') === gateway,
    gatewayKeyPresent: hasGatewayKey,
    databaseIdPresent: hasDatabase,
    urlFetch: 'noch nicht geprüft'
  };
  // Ein GET auf das Gateway ohne Zugangsdaten. Erwartet wird HTTP 405.
  // Das prüft die UrlFetchApp-Berechtigung und Erreichbarkeit, sendet aber
  // weder Benutzer- noch Firmeninformationen.
  try {
    const response = UrlFetchApp.fetch(gateway + '/', {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: false
    });
    result.urlFetch = 'OK – HTTP ' + response.getResponseCode();
  } catch (error) {
    result.urlFetch = 'FEHLER – ' + String(error.message || error);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}
