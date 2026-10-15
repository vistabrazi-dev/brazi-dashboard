/** Valores exatos em centavos; nenhuma conversão cambial ou inferência de moeda. */
export function cents(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(value)) value = value.replaceAll(',', '');
  else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(value)) value = value.replaceAll('.', '').replace(',', '.');
  else if (/^-?\d+,\d{1,2}$/.test(value)) value = value.replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const exact = (negative ? -1n : 1n) * (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
  const result = Number(exact);
  return Number.isSafeInteger(result) ? result : null;
}
export function sum(values: number[]): number {
  const result = values.reduce((total, value) => total + BigInt(value), 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Limite de precisão monetária excedido.');
  return Number(result);
}
/** Maior resto: o rateio fecha exatamente, inclusive em descontos de um centavo. */
export function allocate(total: number, weights: number[]): number[] {
  const denominator = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (denominator === 0n) return weights.map(() => 0);
  const parts = weights.map((weight, index) => ({ index, value: BigInt(total) * BigInt(weight) / denominator, remainder: BigInt(total) * BigInt(weight) % denominator }));
  let remaining = BigInt(total) - parts.reduce((a, b) => a + b.value, 0n);
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining === 0n) break;
    part.value++; remaining--;
  }
  return parts.map(p => Number(p.value));
}

/** Reembolsos observados podem conter frações longas: arredondamento decimal meio para cima. */
export function refundCents(input:unknown):{value:number|null;adjusted:boolean}{
 const ordinary=cents(input);if(ordinary!==null)return {value:ordinary,adjusted:false};
 if(typeof input!=='string'||!/^[-]?\d+\.\d{3,100}$/.test(input.trim()))return {value:null,adjusted:false};
 const text=input.trim(),negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');
 const discarded=fraction.slice(2),adjusted=/[1-9]/.test(discarded);
 const base=BigInt(whole!)*100n+BigInt(fraction.slice(0,2));
 const rounded=(negative?-1n:1n)*(base+(Number(discarded[0])>=5?1n:0n));
 const value=Number(rounded);return Number.isSafeInteger(value)?{value,adjusted}:{value:null,adjusted:false};
}
