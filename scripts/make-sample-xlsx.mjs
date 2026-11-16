import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hoja1');
ws.mergeCells('A1:G1'); ws.getCell('A1').value='GASTOS REALIZADOS EN OBRA SECHURA'; ws.getCell('A1').font={bold:true,size:14};
['ÍTEM','FECHA','N° RECIBO/FACTURA/BOLETA O MOVIMIENTO','BENEFICIARIO/PROVEEDOR','CONCEPTO/DETALLE DEL GASTO','INGRESOS (+)','EGRESOS (-)'].forEach((h,i)=>{const c=ws.getRow(3).getCell(i+1);c.value=h;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F3864'}};});
[['01',new Date(Date.UTC(2026,2,10)),'F001-00012345','FERRETERIA CONSTRUCTORA SECHURA S.A.C.','Cemento',null,390],['02',new Date(Date.UTC(2026,2,11)),'E001-77','TRANSPORTES RIVERA',"Flete",null,1200.5]].forEach((r,k)=>r.forEach((v,i)=>{const c=ws.getRow(4+k).getCell(i+1);c.value=v;c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};if(i==1)c.numFmt='dd/mm/yyyy';if(i==6)c.numFmt='#,##0.00';}));
ws.getCell('D6').value='TOTAL'; ws.getCell('G6').value={formula:'SUM(G4:G5)',result:1590.5}; ws.getColumn(5).width=40;
await wb.xlsx.writeFile('tests/fixtures/original.xlsx');
