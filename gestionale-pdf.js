'use strict';

window.buildQuotePdfDocument = async function (payload, modulePdfs) {
  const library = window.PDFLib;
  if (!library?.PDFDocument) throw new Error('Libreria PDF non disponibile nel modulo originale.');
  const { company, client, quote, models } = payload;
  const pdf = await library.PDFDocument.create();
  pdf.setTitle(`Preventivo ${quote.number}`);
  pdf.setAuthor(pdfSafeText(company.name));
  const regular = await pdf.embedFont(library.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(library.StandardFonts.HelveticaBold);
  const color = library.rgb;
  const width = 841.89;
  const height = 595.28;
  const totals = quoteTotals(quote);
  const rows = quote.items.map((item, index) => {
    const model = models.find(entry => entry.id === item.moduleId);
    return { name: model?.name || item.moduleId, item, totals: totals.lines[index] };
  });
  const rowsPerPage = 10;
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
  const drawTopText = (page, text, x, top, size, font = regular, fill = color(0.13, 0.2, 0.28), maxWidth = 740) => {
    const safeText = fitPdfText(text, font, size, maxWidth);
    page.drawText(safeText, { x, y: height - top - size, size, font, color: fill });
  };
  const drawLine = (page, x1, top, x2, stroke = color(0.87, 0.9, 0.92), thickness = 0.7) => {
    page.drawLine({ start: { x: x1, y: height - top }, end: { x: x2, y: height - top }, thickness, color: stroke });
  };

  for (let pageIndex = 0; pageIndex < summaryPages; pageIndex++) {
    const page = pdf.addPage([width, height]);
    const first = pageIndex === 0;
    if (logo) {
      const maxLogoWidth = 220;
      const maxLogoHeight = 72;
      const scale = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height, 5.5);
      const logoHeight = logo.height * scale;
      const logoWidth = logo.width * scale;
      const logoColumnWidth = 210;
      const logoX = 36 + Math.max(0, (logoColumnWidth - logoWidth) / 2);
      const logoY = height - 18 - logoHeight;
      page.drawImage(logo, { x: logoX, y: logoY, width: logoWidth, height: logoHeight });
    }
    const companyX = logo ? 260 : 36;
    drawTopText(page, company.name || 'Azienda', companyX, 29, 15, bold, color(0.09, 0.24, 0.31), 280);
    drawTopText(page, companyAddress, companyX, 49, 8, regular, color(0.42, 0.49, 0.55), 300);
    drawTopText(page, companyDetails, companyX, 62, 8, regular, color(0.42, 0.49, 0.55), 315);
    drawTopText(page, 'PREVENTIVO', 610, 30, 18, bold, color(0.09, 0.24, 0.31), 195);
    drawTopText(page, `${quote.number} · ${dateLabel(quote.createdAt)}`, 610, 53, 8, regular, color(0.42, 0.49, 0.55), 195);
    drawLine(page, 36, 82, width - 36, color(0.09, 0.49, 0.43), 1.8);
    if (first) {
      drawTopText(page, 'CLIENTE', 36, 96, 8, bold, color(0.42, 0.49, 0.55), 250);
      drawTopText(page, client.name || client.company, 36, 110, 11, bold, color(0.13, 0.2, 0.28), 365);
      drawTopText(page, client.company && client.name ? client.company : '', 36, 125, 9, regular, color(0.3, 0.38, 0.45), 365);
      drawTopText(page, clientAddress, 36, 139, 9, regular, color(0.3, 0.38, 0.45), 365);
      drawTopText(page, clientDetails, 36, 153, 8, regular, color(0.3, 0.38, 0.45), 425);
      drawTopText(page, `Validità: ${quote.validityDays || 30} giorni`, 540, 111, 9, regular, color(0.3, 0.38, 0.45), 265);
    } else {
      drawTopText(page, `CLIENTE: ${client.name || client.company} · ${quote.number}`, 36, 104, 9, bold, color(0.3, 0.38, 0.45), 750);
    }
    const titleTop = first ? 177 : 137;
    drawTopText(page, 'RIEPILOGO ARTICOLI', 36, titleTop, 9, bold, color(0.42, 0.49, 0.55), 750);
    const headTop = titleTop + 17;
    page.drawRectangle({ x: 36, y: height - headTop - 20, width: width - 72, height: 20, color: color(0.94, 0.96, 0.97) });
    drawTopText(page, 'ARTICOLO / CONFIGURAZIONE', 42, headTop + 5, 7, bold, color(0.35, 0.43, 0.5), 330);
    drawTopText(page, 'Q.TÀ', 434, headTop + 5, 7, bold, color(0.35, 0.43, 0.5), 35);
    drawTopText(page, 'LISTINO', 485, headTop + 5, 7, bold, color(0.35, 0.43, 0.5), 60);
    drawTopText(page, 'SCONTO', 578, headTop + 5, 7, bold, color(0.35, 0.43, 0.5), 55);
    drawTopText(page, 'NETTO', 674, headTop + 5, 7, bold, color(0.35, 0.43, 0.5), 90);
    const start = pageIndex * rowsPerPage;
    const pageRows = rows.slice(start, start + rowsPerPage);
    const rowStart = headTop + 27;
    pageRows.forEach((row, rowIndex) => {
      const top = rowStart + rowIndex * 21;
      drawTopText(page, row.name, 42, top, 8, regular, color(0.16, 0.23, 0.3), 365);
      drawTopText(page, String(row.item.quantity || 1), 434, top, 8, regular, color(0.16, 0.23, 0.3), 35);
      drawTopText(page, money(row.item.price), 485, top, 8, regular, color(0.16, 0.23, 0.3), 75);
      drawTopText(page, `${Number(row.item.discount) || 0}%`, 578, top, 8, regular, color(0.16, 0.23, 0.3), 55);
      drawTopText(page, money(row.totals.netTotal), 674, top, 8, bold, color(0.16, 0.23, 0.3), 90);
      drawLine(page, 42, top + 16, width - 42, color(0.92, 0.94, 0.95), 0.45);
    });
    if (pageIndex === summaryPages - 1) {
      const totalsTop = rowStart + pageRows.length * 21 + 5;
      const totalX = 570;
      drawTopText(page, `Totale listino: ${money(totals.listTotal)}`, totalX, totalsTop, 8, regular, color(0.35, 0.43, 0.5), 230);
      drawTopText(page, `Sconti: - ${money(totals.discountTotal)}`, totalX, totalsTop + 13, 8, regular, color(0.35, 0.43, 0.5), 230);
      drawLine(page, totalX, totalsTop + 28, width - 36, color(0.82, 0.87, 0.89));
      drawTopText(page, `Totale scontato (IVA esclusa): ${money(totals.netTotal)}`, totalX, totalsTop + 34, 9, bold, color(0.09, 0.45, 0.39), 235);
      drawTopText(page, `IVA ${totals.vatRate}%: ${money(totals.vatTotal)}`, totalX, totalsTop + 50, 8, regular, color(0.35, 0.43, 0.5), 230);
      drawTopText(page, `TOTALE: ${money(totals.grossTotal)}`, totalX, totalsTop + 66, 12, bold, color(0.09, 0.45, 0.39), 230);
      if (quote.notes) drawTopText(page, `Note: ${quote.notes}`, 36, totalsTop + 80, 7, regular, color(0.35, 0.43, 0.5), 720);
    }
    drawLine(page, 36, 566, width - 36);
    drawTopText(page, company.footerNotes || company.name, 36, 573, 7, regular, color(0.48, 0.55, 0.61), 680);
    drawTopText(page, `Riepilogo ${pageIndex + 1}/${summaryPages}`, 730, 573, 7, regular, color(0.48, 0.55, 0.61), 75);
  }

  for (const moduleBytes of modulePdfs) {
    const modulePdf = await library.PDFDocument.load(new Uint8Array(moduleBytes));
    const pages = await pdf.copyPages(modulePdf, modulePdf.getPageIndices());
    pages.forEach(page => pdf.addPage(page));
  }
  return pdf.save();
};

function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\u0000-\u00ff\u20ac]/g, '?');
}

function fitPdfText(text, font, size, maxWidth) {
  let value = pdfSafeText(text);
  while (value.length > 1 && font.widthOfTextAtSize(value, size) > maxWidth) value = `${value.slice(0, -2)}...`;
  return value;
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
