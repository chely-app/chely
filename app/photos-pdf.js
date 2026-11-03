/* Hecho por ChatGPT · 2026-11-03
 * Agrupa fotos de un mismo informe en un PDF multipágina, únicamente en
 * el navegador. No envía imágenes a servicios externos ni usa librerías CDN.
 * Una página por foto, en el orden que la persona confirme.
 */
(() => {
  'use strict';
  const MAX_PAGES = 12;
  const MAX_BYTES = 20 * 1024 * 1024;
  const accepted = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const enc = new TextEncoder();

  async function jpegPage(file) {
    if (!file || !accepted.has(file.type) || !file.size || file.size > MAX_BYTES)
      throw new Error('Revisá las fotos: deben ser JPG, PNG o WebP y pesar hasta 20 MB cada una.');
    let image, imageURL = null;
    try {
      if (typeof createImageBitmap === 'function') {
        try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch { /* Algunos navegadores móviles necesitan HTMLImageElement. */ }
      }
      if (!image) {
        imageURL = URL.createObjectURL(file);
        image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('No se pudo abrir la foto. Revisá su formato.'));
          img.src = imageURL;
        });
      }
      if (!image.width || !image.height)
        throw new Error('Una de las fotos no tiene dimensiones válidas.');
      const limit = 2000;
      const factor = Math.min(1, limit / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * factor));
      const height = Math.max(1, Math.round(image.height * factor));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Este dispositivo no pudo preparar las páginas.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      canvas.width = 0; canvas.height = 0;
      if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('No se pudo convertir una de las fotos.');
      return { width, height, bytes: new Uint8Array(await jpeg.arrayBuffer()) };
    } finally {
      if (image && typeof image.close === 'function') image.close();
      if (imageURL) URL.revokeObjectURL(imageURL);
    }
  }

  async function toFile(files) {
    const selected = Array.from(files || []);
    if (!selected.length || selected.length > MAX_PAGES)
      throw new Error('Elegí entre 1 y ' + MAX_PAGES + ' fotos del mismo informe.');
    const pages = [];
    for (const photo of selected) pages.push(await jpegPage(photo));

    const chunks = [], offsets = [0];
    let position = 0;
    const push = value => {
      const bytes = typeof value === 'string' ? enc.encode(value) : value;
      chunks.push(bytes); position += bytes.byteLength;
    };
    const object = (id, body) => {
      offsets[id] = position;
      push(id + ' 0 obj\n' + body + '\nendobj\n');
    };
    const stream = (id, dictionary, bytes) => {
      offsets[id] = position;
      push(id + ' 0 obj\n' + dictionary + ' /Length ' + bytes.length +
        ' >>\nstream\n');
      push(bytes);
      push('\nendstream\nendobj\n');
    };
    push('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
    object(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = 3 + i * 3, contentsId = pageId + 1, imageId = pageId + 2;
      const maxW = 555, maxH = 802;
      const scale = Math.min(maxW / page.width, maxH / page.height);
      const w = +(page.width * scale).toFixed(2);
      const h = +(page.height * scale).toFixed(2);
      const x = +((595 - w) / 2).toFixed(2);
      const y = +((842 - h) / 2).toFixed(2);
      object(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /XObject << /Im0 ' + imageId +
        ' 0 R >> >> /Contents ' + contentsId + ' 0 R >>');
      stream(contentsId, '<<', enc.encode(
        'q\n' + w + ' 0 0 ' + h + ' ' + x + ' ' + y + ' cm\n/Im0 Do\nQ\n'));
      stream(imageId, '<< /Type /XObject /Subtype /Image /Width ' + page.width +
        ' /Height ' + page.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', page.bytes);
    }
    const xrefAt = position;
    const totalObjects = 3 + pages.length * 3;
    push('xref\n0 ' + totalObjects + '\n0000000000 65535 f \n');
    for (let id = 1; id < totalObjects; id++)
      push(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    push('trailer\n<< /Size ' + totalObjects + ' /Root 1 0 R >>\n' +
      'startxref\n' + xrefAt + '\n%%EOF\n');
    const pdf = new File(chunks, 'informe-' + pages.length + '-paginas.pdf',
      { type: 'application/pdf' });
    if (pdf.size > MAX_BYTES)
      throw new Error('El PDF con las fotos supera los 20 MB. Probá con menos páginas o fotos más livianas.');
    return pdf;
  }

  window.ChelyPhotosPDF = Object.freeze({ toFile, maxPages: MAX_PAGES });
})();
