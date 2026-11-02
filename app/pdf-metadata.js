/* Chely · Lectura local del texto de PDF, sin llamadas a modelos de IA.
   PDF.js version fija. El PDF se procesa en el navegador: no se envía al CDN.
   Si no tiene texto, permanece pendiente para una lectura explícita con IA. */
(() => {
  'use strict';
  const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/';
  let pdfjsPromise = null;
  async function library() {
    if (!pdfjsPromise) pdfjsPromise = import(PDFJS_BASE + 'pdf.min.mjs')
      .then(lib => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
        return lib;
      }).catch(e => { pdfjsPromise = null; throw e; });
    return pdfjsPromise;
  }
  async function read(file) {
    if (!file || !/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024)
      throw new Error('Archivo PDF inválido');
    const lib = await library();
    const loading = lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      stopAtErrors: false
    });
    let doc;
    try {
      doc = await loading.promise;
      let text = '';
      let header = '';
      let overflow = doc.numPages > 50;
      for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let pageText = '';
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          pageText += item.str + (item.hasEOL ? '\n' : ' ');
        }
        if (i <= 3) header += '\n' + pageText.slice(0, 9000);
        if (text.length + pageText.length > 55000) {
          overflow = true;
          break;
        }
        text += pageText + '\n';
        page.cleanup();
      }
      let infoTitle = '';
      try { infoTitle = String((await doc.getMetadata()).info?.Title || ''); }
      catch { /* Los metadatos PDF son opcionales. */ }
      // No persistir un informe parcial como si fuera un informe completo.
      return {
        text: overflow ? '' : text.trim(),
        header: header.slice(0, 14000),
        pdfTitle: infoTitle.slice(0, 150),
        pages: doc.numPages,
        hasSelectableText: header.trim().length >= 45,
        complete: !overflow
      };
    } finally {
      try { await loading.destroy(); } catch { /* La lectura ya terminó. */ }
    }
  }
  window.ChelyPdf = Object.freeze({ read });
})();
