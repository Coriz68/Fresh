'use strict';

window.buildQuotePdfDocument = async function (payload, modulePdfs) {
  const library = window.PDFLib;
  if (!library?.PDFDocument) throw new Error('Libreria PDF non disponibile nel modulo originale.');
  const { company, client, quote, models } = payload;
  const pdf = await library.PDFDocument.create();
  pdf.setTitle(`Preventivo ${quote.number}`);
  pdf.setAuthor('CorradoWEB 2026');
  pdf.setCreator('CorradoWEB 2026');
  if (!quote.id || !quote.revision || quote.kind !== 'customer') throw new Error('Identità del PDF cliente incompleta.');
  pdf.setKeywords([`quote_id=${quote.id}`, `revision=${quote.revision}`, 'kind=customer', ...(quote.recipient ? [`recipient=${quote.recipient}`] : [])]);
  const regular = await pdf.embedFont(library.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(library.StandardFonts.HelveticaBold);
  const color = library.rgb;
  const width = 841.89;
  const height = 595.28;
  const ink = color(0.1, 0.17, 0.23);
  const muted = color(0.4, 0.47, 0.53);
  const teal = color(0.07, 0.34, 0.32);
  const accent = color(0.1, 0.58, 0.46);
  const pale = color(0.95, 0.97, 0.97);
  const light = color(0.98, 0.985, 0.985);
  const white = color(1, 1, 1);
  const totals = quoteTotals(quote);
  const rows = quote.items.map((item, index) => {
    const model = models.find(entry => entry.id === item.moduleId);
    return { name: model?.name || item.moduleId, item, totals: totals.lines[index] };
  });
  const rowsPerPage = 9;
  const summaryPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  let logo = null;
  if (company.logo) {
    const [header, encoded] = company.logo.split(',');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    logo = header.includes('image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  }
  const companyAddress = [company.address, company.postalCode, company.city, company.province ? `(${company.province})` : ''].filter(Boolean).join(' ');
  const companyDetails = [company.vatNumber ? `P. IVA ${company.vatNumber}` : '', company.taxCode ? `C.F. ${company.taxCode}` : '', company.phone, company.email, company.website].filter(Boolean).join(' · ');
  const clientAddress = [client.address, client.postalCode, client.city, client.province ? `(${client.province})` : ''].filter(Boolean).join(' ');
  const clientDetails = [client.vatNumber ? `P. IVA ${client.vatNumber}` : '', client.taxCode ? `C.F. ${client.taxCode}` : '', client.email, client.phone].filter(Boolean).join(' · ');
  const drawTopText = (page, text, x, top, size, font = regular, fill = ink, maxWidth = 740) => {
    const safeText = fitPdfText(text, font, size, maxWidth);
    page.drawText(safeText, { x, y: height - top - size, size, font, color: fill });
  };
  const drawLine = (page, x1, top, x2, stroke = color(0.87, 0.9, 0.92), thickness = 0.7) => {
    page.drawLine({ start: { x: x1, y: height - top }, end: { x: x2, y: height - top }, thickness, color: stroke });
  };
  const drawTopRect = (page, x, top, rectWidth, rectHeight, fill) => {
    page.drawRectangle({ x, y: height - top - rectHeight, width: rectWidth, height: rectHeight, color: fill });
  };

  for (let pageIndex = 0; pageIndex < summaryPages; pageIndex++) {
    const page = pdf.addPage([width, height]);
    const first = pageIndex === 0;
    drawTopRect(page, 36, 12, width - 72, 4, accent);
    if (logo) {
      const maxLogoWidth = 260;
      const maxLogoHeight = 108;
      const scale = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height, 5.5);
      const logoHeight = logo.height * scale;
      const logoWidth = logo.width * scale;
      const logoColumnWidth = 260;
      const logoX = 36 + Math.max(0, (logoColumnWidth - logoWidth) / 2);
      const logoY = height - 18 - logoHeight;
      page.drawImage(logo, { x: logoX, y: logoY, width: logoWidth, height: logoHeight });
    }
    const companyX = logo ? 318 : 36;
    drawTopText(page, company.name || 'Azienda', companyX, 31, 16, bold, teal, 275);
    drawTopText(page, companyAddress, companyX, 54, 8, regular, muted, 275);
    drawTopText(page, companyDetails, companyX, 68, 8, regular, muted, 275);
    drawTopRect(page, 610, 23, 195, 74, teal);
    drawTopRect(page, 610, 23, 4, 74, accent);
    drawTopText(page, 'PREVENTIVO', 626, 31, 8, bold, white, 165);
    drawTopText(page, quote.number, 626, 47, 14, bold, white, 165);
    drawTopText(page, dateLabel(quote.createdAt), 626, 71, 8, regular, color(0.82, 0.91, 0.89), 165);
    drawLine(page, 36, 128, width - 36, color(0.83, 0.88, 0.88), 0.8);
    if (first) {
      drawTopRect(page, 36, 140, width - 72, 55, pale);
      drawTopText(page, 'CLIENTE', 50, 147, 8, bold, muted, 400);
      drawTopText(page, client.name || client.company, 50, 160, 12, bold, ink, 485);
      const clientSubline = [
        client.company && client.name ? client.company : '', clientAddress, clientDetails
      ].filter(Boolean).join(' · ');
      drawTopText(page, clientSubline, 50, 178, 7, regular, muted, 730);
      drawTopText(page, 'VALIDITÀ', 622, 147, 8, bold, muted, 155);
      drawTopText(page, `${quote.validityDays || 30} giorni`, 622, 161, 11, bold, teal, 155);
    } else {
      drawTopText(page, `CLIENTE: ${client.name || client.company}`, 36, 106, 9, bold, ink, 525);
    }
    const titleTop = first ? 210 : 137;
    drawTopText(page, 'RIEPILOGO ARTICOLI', 36, titleTop, 10, bold, teal, 750);
    const headTop = titleTop + 17;
    drawTopRect(page, 36, headTop, width - 72, 24, teal);
    drawTopText(page, 'ARTICOLO / CONFIGURAZIONE', 44, headTop + 7, 7, bold, white, 330);
    drawTopText(page, 'Q.TÀ', 434, headTop + 7, 7, bold, white, 35);
    drawTopText(page, 'LISTINO', 485, headTop + 7, 7, bold, white, 60);
    drawTopText(page, 'SCONTO', 578, headTop + 7, 7, bold, white, 55);
    drawTopText(page, 'NETTO', 674, headTop + 7, 7, bold, white, 90);
    const start = pageIndex * rowsPerPage;
    const pageRows = rows.slice(start, start + rowsPerPage);
    const rowStart = headTop + 30;
    pageRows.forEach((row, rowIndex) => {
      const top = rowStart + rowIndex * 21;
      if (rowIndex % 2 === 0) drawTopRect(page, 36, top - 3, width - 72, 21, light);
      drawTopText(page, row.name, 44, top + 2, 8, regular, ink, 365);
      drawTopText(page, String(row.item.quantity || 1), 434, top + 2, 8, regular, ink, 35);
      drawTopText(page, money(row.item.price), 485, top + 2, 8, regular, ink, 75);
      drawTopText(page, `${Number(row.item.discount) || 0}%`, 578, top + 2, 8, regular, ink, 55);
      drawTopText(page, money(row.totals.netTotal), 674, top + 2, 8, bold, ink, 90);
      drawLine(page, 42, top + 18, width - 42, color(0.9, 0.93, 0.93), 0.45);
    });
    if (pageIndex === summaryPages - 1) {
      const totalsTop = rowStart + pageRows.length * 21 + 5;
      const totalX = 554;
      drawTopRect(page, totalX, totalsTop, 251, 94, pale);
      drawTopText(page, `Totale listino: ${money(totals.listTotal)}`, totalX + 12, totalsTop + 8, 8, regular, muted, 227);
      drawTopText(page, `Sconti applicati: - ${money(totals.discountTotal)}`, totalX + 12, totalsTop + 22, 8, regular, muted, 227);
      drawLine(page, totalX + 12, totalsTop + 38, width - 48, color(0.82, 0.88, 0.87));
      drawTopText(page, `Netto (IVA esclusa): ${money(totals.netTotal)}`, totalX + 12, totalsTop + 44, 8, bold, teal, 227);
      drawTopText(page, `IVA ${totals.vatRate}%: ${money(totals.vatTotal)}`, totalX + 12, totalsTop + 59, 8, regular, muted, 227);
      drawTopText(page, `TOTALE: ${money(totals.grossTotal)}`, totalX + 12, totalsTop + 74, 12, bold, teal, 227);
      if (quote.notes) drawTopText(page, `NOTE: ${quote.notes}`, 36, totalsTop + 9, 7, regular, muted, 490);
    }
    drawLine(page, 36, 566, width - 36);
    drawTopText(page, company.footerNotes || company.name, 36, 573, 7, regular, muted, 680);
    drawTopText(page, `RIEPILOGO ${pageIndex + 1}/${summaryPages}`, 713, 573, 7, bold, muted, 92);
  }

  for (const moduleBytes of modulePdfs) {
    const modulePdf = await library.PDFDocument.load(new Uint8Array(moduleBytes));
    const pages = await pdf.copyPages(modulePdf, modulePdf.getPageIndices());
    pages.forEach(page => pdf.addPage(page));
  }
  return pdf.save();
};

window.buildSupplierPdfDocument = async function (modulePdfs, identity) {
  const library = window.PDFLib;
  if (!library?.PDFDocument) throw new Error('Libreria PDF non disponibile nel modulo originale.');
  if (!identity?.id || !identity?.revision || identity.kind !== 'supplier' || !identity.number || !Array.isArray(identity.moduleIds) || !identity.moduleIds.length) throw new Error('Identità del PDF fornitore incompleta.');
  const pdf = await library.PDFDocument.create();
  pdf.setTitle(`Moduli fornitore ${identity.number}`);
  pdf.setSubject(`Riferimento preventivo: ${identity.number}`);
  pdf.setKeywords([`quote_id=${identity.id}`, `revision=${identity.revision}`, 'kind=supplier', ...(identity.recipient ? [`recipient=${identity.recipient}`] : []), `module_ids=${identity.moduleIds.join('|')}`]);
  pdf.setAuthor('CorradoWEB 2026');
  pdf.setCreator('CorradoWEB 2026');
  for (const moduleBytes of modulePdfs) {
    const modulePdf = await library.PDFDocument.load(new Uint8Array(moduleBytes));
    const pages = await pdf.copyPages(modulePdf, modulePdf.getPageIndices());
    pages.forEach(page => pdf.addPage(page));
  }
  if (!pdf.getPageCount()) throw new Error('Il preventivo non contiene pagine modulo.');
  return pdf.save();
};

function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[^\u0000-\u00ff\u20ac]/g, '?');
}

function fitPdfText(text, font, size, maxWidth) {
  let value = pdfSafeText(text);
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  const suffix = '...';
  if (font.widthOfTextAtSize(suffix, size) > maxWidth) return '';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, middle).trimEnd()}${suffix}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low).trimEnd()}${suffix}`;
}

function money(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('it-IT').format(date);
}

function quoteTotals(quote) {
  const lines = quote.items.map(item => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const price = Math.max(0, Number(item.price) || 0);
    const discount = Math.min(100, Math.max(0, Number(item.discount) || 0));
    const listTotal = quantity * price;
    const discountTotal = listTotal * discount / 100;
    return { listTotal, discountTotal, netTotal: listTotal - discountTotal };
  });
  const listTotal = lines.reduce((sum, line) => sum + line.listTotal, 0);
  const discountTotal = lines.reduce((sum, line) => sum + line.discountTotal, 0);
  const netTotal = lines.reduce((sum, line) => sum + line.netTotal, 0);
  const vatRate = Math.max(0, Number(quote.vatRate) || 0);
  const vatTotal = netTotal * vatRate / 100;
  return { lines, listTotal, discountTotal, netTotal, vatRate, vatTotal, grossTotal: netTotal + vatTotal };
}
