import React from 'react';
/** Standard Code 39 symbol patterns (wide=2, narrow=1); only our ticket alphabet is accepted.
 * Reference: https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/oned/Code39Reader.java
 */
const symbols: Readonly<Record<string, number>> = { '0':0x034,'1':0x121,'2':0x061,'3':0x160,'4':0x031,'5':0x130,'6':0x070,'7':0x025,'8':0x124,'9':0x064,A:0x109,B:0x049,C:0x148,D:0x019,E:0x118,F:0x058,S:0x046,'*':0x094 };
export function ticketBarcodeBars(code: string): { bars: readonly { x: number; width: number }[]; width: number } {
 if (!/^(?:CS|DS|AC|AD|CC|DC)[0-9A-F]{14}$/u.test(code)) throw new Error('Invalid ticket barcode.');
 let x=10; const bars: { x: number; width: number }[] = [];
 for (const character of '*' + code + '*') {
  const symbol = symbols[character]; if (symbol === undefined) throw new Error('Unknown barcode symbol.');
  for (let bit=8; bit>=0; bit--) { const width = (symbol & (1 << bit)) !== 0 ? 2 : 1; if (bit % 2 === 0) bars.push({ x, width }); x += width; }
  x++;
 }
 return { bars, width: x+9 };
}
export function TicketBarcode({ code }: { code: string }): React.JSX.Element {
 const pattern = ticketBarcodeBars(code);
 return <svg className="ticket-barcode" role="img" aria-label={'Code 39: ' + code} viewBox={'0 0 ' + pattern.width + ' 64'} preserveAspectRatio="none"><rect width={pattern.width} height={64} fill="white" />{pattern.bars.map((bar) => <rect key={bar.x} x={bar.x} y={4} width={bar.width} height={56} fill="black" />)}</svg>;
}
