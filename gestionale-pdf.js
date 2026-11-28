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
  const text = color(0.2, 0.26, 0.32);
  const rule = color(0.84, 0.88, 0.89);
  const companyStreet = [company.address].filter(Boolean).join('');
  const companyTown = [company.postalCode, company.city, provinceLabel(company.province)].filter(Boolean).join(' ');
  const companyLines = [
    [companyStreet, companyTown].filter(Boolean).join(' - '),
    [company.vatNumber ? `P. IVA ${company.vatNumber}` : '', company.taxCode ? `C.F. ${company.taxCode}` : ''].filter(Boolean).join('   '),
    [company.phone ? `Tel. ${company.phone}` : '', company.email].filter(Boolean).join('   '),
    company.website || ''
  ].filter(Boolean);
  const clientName = client.name || client.company || '';
  const clientSecondName = client.company && client.name ? client.company : '';
  const clientAddressLines = [
    client.address || '',
    [client.postalCode, client.city, provinceLabel(client.province)].filter(Boolean).join(' ')
  ].filter(Boolean);
  const clientFiscal = [client.vatNumber ? `P. IVA ${client.vatNumber}` : '', client.taxCode ? `C.F. ${client.taxCode}` : ''].filter(Boolean);
  const clientContacts = [client.phone ? `Tel. ${client.phone}` : '', client.email || ''].filter(Boolean);
  const drawTopText = (page, value, x, top, size, font = regular, fill = ink, maxWidth = 740) => {
    const safeText = fitPdfText(value, font, size, maxWidth);
    if (safeText) page.drawText(safeText, { x, y: height - top - size, size, font, color: fill });
    return safeText;
  };
  const drawRightText = (page, value, right, top, size, font = regular, fill = ink, maxWidth = 200) => {
    const safeText = fitPdfText(value, font, size, maxWidth);
    if (!safeText) return safeText;
    const textWidth = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: right - textWidth, y: height - top - size, size, font, color: fill });
    return safeText;
  };
  const drawLine = (page, x1, top, x2, stroke = color(0.87, 0.9, 0.92), thickness = 0.7) => {
    page.drawLine({ start: { x: x1, y: height - top }, end: { x: x2, y: height - top }, thickness, color: stroke });
  };
  const drawTopRect = (page, x, top, rectWidth, rectHeight, fill) => {
    page.drawRectangle({ x, y: height - top - rectHeight, width: rectWidth, height: rectHeight, color: fill });
  };
  const drawLabel = (page, value, x, top) => drawTopText(page, value, x, top, 7, bold, muted, 200);
  // Colonne del riepilogo: importi allineati a destra per una lettura immediata.
  const columns = { article: 46, quantity: 470, price: 590, discount: 660, net: 795 };

  for (let pageIndex = 0; pageIndex < summaryPages; pageIndex++) {
    const page = pdf.addPage([width, height]);
    const first = pageIndex === 0;
    drawTopRect(page, 36, 12, width - 72, 4, accent);

    // Intestazione: fascia unica alta quanto il logo, con dati aziendali centrati e riquadro preventivo allineato.
    const bandTop = 24;
    const bandHeight = 104;
    let companyX = 36;
    if (logo) {
      const maxLogoWidth = 230;
      const scale = Math.min(maxLogoWidth / logo.width, bandHeight / logo.height, 5.5);
      const logoHeight = logo.height * scale;
      const logoWidth = logo.width * scale;
      page.drawImage(logo, { x: 36, y: height - bandTop - logoHeight - (bandHeight - logoHeight) / 2, width: logoWidth, height: logoHeight });
      companyX = 36 + Math.max(logoWidth, 120) + 24;
      page.drawLine({ start: { x: companyX - 12, y: height - bandTop - 8 }, end: { x: companyX - 12, y: height - bandTop - bandHeight + 8 }, thickness: 0.6, color: rule });
    }
    const companyWidth = 594 - companyX;
    const companyBlockHeight = 22 + companyLines.length * 14;
    const companyTop = bandTop + Math.max(0, (bandHeight - companyBlockHeight) / 2);
    drawTopText(page, company.name || 'Azienda', companyX, companyTop, 17, bold, teal, companyWidth);
    companyLines.forEach((line, index) => drawTopText(page, line, companyX, companyTop + 25 + index * 14, 9, regular, text, companyWidth));

    drawTopRect(page, 610, bandTop, 195, bandHeight, teal);
    drawTopRect(page, 610, bandTop, 4, bandHeight, accent);
    drawTopText(page, 'PREVENTIVO', 628, bandTop + 16, 8, bold, color(0.8, 0.9, 0.88), 165);
    drawTopText(page, quote.number, 628, bandTop + 31, 15, bold, white, 165);
    drawLine(page, 628, bandTop + 58, 789, color(0.3, 0.52, 0.5), 0.6);
    drawTopText(page, 'Data', 628, bandTop + 66, 8, regular, color(0.8, 0.9, 0.88), 70);
    drawRightText(page, dateLabel(quote.createdAt), 789, bandTop + 66, 9, bold, white, 100);
    drawTopText(page, 'Validità', 628, bandTop + 82, 8, regular, color(0.8, 0.9, 0.88), 70);
    drawRightText(page, `${quote.validityDays || 30} giorni`, 789, bandTop + 82, 9, bold, white, 100);
    drawLine(page, 36, 140, width - 36, color(0.83, 0.88, 0.88), 0.8);

    if (first) {
      // Dati cliente in colonne leggibili invece di un'unica riga compressa.
      const panelTop = 152;
      const panelHeight = 72;
      drawTopRect(page, 36, panelTop, width - 72, panelHeight, pale);
      drawTopRect(page, 36, panelTop, 3, panelHeight, accent);
      drawLabel(page, 'SPETT.LE CLIENTE', 52, panelTop + 11);
      drawTopText(page, clientName, 52, panelTop + 24, 13, bold, ink, 250);
      if (clientSecondName) drawTopText(page, clientSecondName, 52, panelTop + 43, 9, regular, text, 250);
      drawLabel(page, 'INDIRIZZO', 330, panelTop + 11);
      [...clientAddressLines, ...clientFiscal].slice(0, 3)
        .forEach((line, index) => drawTopText(page, line, 330, panelTop + 25 + index * 13, 9, regular, text, 225));
      drawLabel(page, 'CONTATTI', 575, panelTop + 11);
      clientContacts.slice(0, 2)
        .forEach((line, index) => drawTopText(page, line, 575, panelTop + 25 + index * 13, 9, regular, text, 220));
    } else {
      drawTopText(page, `CLIENTE: ${clientName}`, 36, 150, 9, bold, ink, 525);
    }

    const titleTop = first ? 238 : 168;
    drawTopText(page, 'RIEPILOGO ARTICOLI', 36, titleTop, 10, bold, teal, 750);
    const headTop = titleTop + 16;
    drawTopRect(page, 36, headTop, width - 72, 22, teal);
    drawTopText(page, 'ARTICOLO / CONFIGURAZIONE', columns.article, headTop + 7, 7, bold, white, 330);
    drawRightText(page, 'Q.TÀ', columns.quantity, headTop + 7, 7, bold, white);
    drawRightText(page, 'LISTINO', columns.price, headTop + 7, 7, bold, white);
    drawRightText(page, 'SCONTO', columns.discount, headTop + 7, 7, bold, white);
    drawRightText(page, 'NETTO', columns.net, headTop + 7, 7, bold, white);
    const start = pageIndex * rowsPerPage;
    const pageRows = rows.slice(start, start + rowsPerPage);
    const rowStart = headTop + 28;
    pageRows.forEach((row, rowIndex) => {
      const top = rowStart + rowIndex * 21;
      if (rowIndex % 2 === 0) drawTopRect(page, 36, top - 4, width - 72, 21, light);
      drawTopText(page, row.name, columns.article, top + 2, 9, regular, ink, 380);
      drawRightText(page, String(row.item.quantity || 1), columns.quantity, top + 2, 9, regular, ink, 40);
      drawRightText(page, money(row.item.price), columns.price, top + 2, 9, regular, ink, 100);
      drawRightText(page, `${Number(row.item.discount) || 0}%`, columns.discount, top + 2, 9, regular, ink, 60);
      drawRightText(page, money(row.totals.netTotal), columns.net, top + 2, 9, bold, ink, 110);
      drawLine(page, 36, top + 17, width - 36, color(0.9, 0.93, 0.93), 0.45);
    });
    if (pageIndex === summaryPages - 1) {
      const totalsTop = rowStart + pageRows.length * 21 + 4;
      const totalX = 565;
      const valueRight = width - 48;
      drawTopRect(page, totalX, totalsTop, width - 36 - totalX, 92, pale);
      const totalLine = (label, value, top, font = regular, fill = text, size = 9) => {
        drawTopText(page, label, totalX + 12, top, size, font, fill, 120);
        drawRightText(page, value, valueRight, top, size, font, fill, 110);
      };
      totalLine('Totale listino', money(totals.listTotal), totalsTop + 9);
      totalLine('Sconti applicati', `- ${money(totals.discountTotal)}`, totalsTop + 23);
      drawLine(page, totalX + 12, totalsTop + 38, valueRight, color(0.82, 0.88, 0.87));
      totalLine('Imponibile', money(totals.netTotal), totalsTop + 44, bold, teal);
      totalLine(`IVA ${totals.vatRate}%`, money(totals.vatTotal), totalsTop + 58);
      drawTopRect(page, totalX, totalsTop + 72, width - 36 - totalX, 20, teal);
      totalLine('TOTALE', money(totals.grossTotal), totalsTop + 77, bold, white, 10);
      if (quote.notes) {
        drawLabel(page, 'NOTE', 36, totalsTop + 9);
        drawTopText(page, quote.notes, 36, totalsTop + 21, 8, regular, text, 500);
      }
    }
    drawLine(page, 36, 566, width - 36);
    drawTopText(page, company.footerNotes || company.name, 36, 573, 7, regular, muted, 660);
    drawRightText(page, `Pagina ${pageIndex + 1} di ${summaryPages}`, width - 36, 573, 7, bold, muted, 100);
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

function provinceLabel(value) {
  // Evita "((AN))" quando la provincia è già stata inserita tra parentesi.
  const province = String(value ?? '').trim().replace(/^\(+\s*|\s*\)+$/g, '');
  return province ? `(${province})` : '';
}

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
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(value) || 0);
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
