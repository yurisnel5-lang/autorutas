// demoData.js
// Facturas de ejemplo para poder probar toda la app (clasificación de zonas,
// optimización de ruta, asignación de choferes, mapa en vivo) ANTES de
// conectar QuickBooks de verdad. Se usan automáticamente si config.demoMode = true.

function demoInvoicesForDate(dateStr) {
  return [
    { id: 'demo-1', docNumber: '1001', customerName: 'Panadería La Espiga', totalAmt: 245.50, address: '1234 NW 27th Ave, Miami, FL 33125', postalCode: '33125' },
    { id: 'demo-2', docNumber: '1002', customerName: 'Ferretería Hidalgo', totalAmt: 89.10, address: '780 NW 36th St, Miami, FL 33127', postalCode: '33127' },
    { id: 'demo-3', docNumber: '1003', customerName: 'Café Versalles', totalAmt: 512.00, address: '3555 NE 2nd Ave, Miami, FL 33137', postalCode: '33137' },
    { id: 'demo-4', docNumber: '1004', customerName: 'Farmacia del Sol', totalAmt: 132.75, address: '2100 SW 8th St, Miami, FL 33135', postalCode: '33135' },
    { id: 'demo-5', docNumber: '1005', customerName: 'Restaurante El Palmar', totalAmt: 620.40, address: '5600 SW 40th St, Miami, FL 33155', postalCode: '33155' },
    { id: 'demo-6', docNumber: '1006', customerName: 'Mercado Los Andes', totalAmt: 310.25, address: '8900 SW 24th St, Miami, FL 33165', postalCode: '33165' },
    { id: 'demo-7', docNumber: '1007', customerName: 'Cafetería Brickell', totalAmt: 75.00, address: '150 SE 2nd Ave, Miami, FL 33131', postalCode: '33131' },
    { id: 'demo-8', docNumber: '1008', customerName: 'Panadería Vizcaya', totalAmt: 198.60, address: '1500 NW 7th St, Miami, FL 33125', postalCode: '33125' }
  ].map((inv) => ({ ...inv, txnDate: dateStr }));
}

module.exports = { demoInvoicesForDate };

