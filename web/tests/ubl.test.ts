import { describe, expect, test } from 'bun:test';
import { extractInvoice, parseXml } from '../src/lib/ubl';
import { parseAmount, parseDate, parseCSV } from '../src/lib/tabular';
import { nitDV } from '../src/lib/format';

const invoice = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>SETP990000123</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">abc123</cbc:UUID>
  <cbc:IssueDate>2026-10-15</cbc:IssueDate><cbc:DueDate>2026-11-14</cbc:DueDate><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Proveedor &amp; Cía S.A.S.</cbc:RegistrationName><cbc:CompanyID schemeID="7" schemeName="31">900123456</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Cliente Ltda</cbc:RegistrationName><cbc:CompanyID schemeID="3">800987654</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">19000.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount>100000.00</cbc:TaxableAmount><cbc:TaxAmount>19000.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:WithholdingTaxTotal><cbc:TaxAmount>2500.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount>100000.00</cbc:TaxableAmount><cbc:TaxAmount>2500.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>2.50</cbc:Percent><cac:TaxScheme><cbc:ID>06</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>100000.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount>100000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>119000.00</cbc:TaxInclusiveAmount><cbc:PayableAmount>119000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="94">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount>100000.00</cbc:LineExtensionAmount><cac:Item><cbc:Description>Servicio de soporte</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;

describe('Factura electrónica UBL', () => {
  test('extrae campos principales', () => {
    const r = extractInvoice(invoice);
    expect(r.fields.numero_factura).toBe('SETP990000123');
    expect(r.fields.emisor).toBe('Proveedor & Cía S.A.S.');
    expect(r.fields.nit_emisor).toBe('900123456');
    expect(r.fields.dv_emisor).toBe('7');
    expect(r.fields.iva).toBe(19000);
    expect(r.fields.rete_fuente).toBe(2500);
    expect(r.fields.total).toBe(119000);
    expect(r.fields.lineas?.[0].descripcion).toBe('Servicio de soporte');
    expect(r.issues).toEqual([]);
  });
  test('lee factura dentro de AttachedDocument', () => {
    const att = `<AttachedDocument xmlns:cac="x" xmlns:cbc="y"><cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${invoice.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}]]></cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;
    expect(extractInvoice(att).fields.numero_factura).toBe('SETP990000123');
  });
  test('rechaza entidades externas (XXE)', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')).toThrow();
  });
  test('no inventa campos faltantes', () => {
    const r = extractInvoice('<Invoice><cbc:IssueDate xmlns:cbc="y">2026-01-01</cbc:IssueDate></Invoice>');
    expect(r.fields.total).toBeUndefined();
    expect(r.issues).toContain('falta_total');
  });
});

describe('Utilidades', () => {
  test('importes en formatos colombianos', () => {
    expect(parseAmount('1.234.567,89')).toBe(1234567.89);
    expect(parseAmount('$ 1.000')).toBe(1000);
    expect(parseAmount('-25.000,50')).toBe(-25000.5);
    expect(parseAmount('1,234.5')).toBe(1234.5);
    expect(parseAmount('(500)')).toBe(-500);
  });
  test('fechas', () => {
    expect(parseDate('15/10/2026')).toBe('2026-10-15');
    expect(parseDate('2026-1-5')).toBe('2026-01-05');
  });
  test('CSV con punto y coma y comillas', () => {
    expect(parseCSV('a;b\n"x;y";2\n')).toEqual([['a', 'b'], ['x;y', '2']]);
  });
  test('dígito de verificación NIT', () => {
    expect(nitDV('900123456')).toBe('8');
    expect(nitDV('800197268')).toBe('4');
  });
});
