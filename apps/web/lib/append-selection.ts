/** Half-open source ranges. Large selections never expand into per-message sets. */
export type AppendRange = [number, number];
export type AppendSelection =
  | {indexes:number[];ranges?:never;selected_count?:never}
  | {ranges:AppendRange[];selected_count:number;indexes?:never};

export const LEGACY_APPEND_LIMIT = 250;
export const APPEND_RANGE_LIMIT = 4096;

export function mergeAppendRanges(values:ReadonlyArray<AppendRange>):AppendRange[] {
  const merged:AppendRange[]=[];
  for(const [start,end] of [...values].sort((a,b)=>a[0]-b[0])){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw new Error("Invalid source range");
    const last=merged.at(-1);
    if(last&&start<=last[1])last[1]=Math.max(last[1],end);
    else merged.push([start,end]);
  }
  return merged;
}

export function appendSelectionRanges(value:AppendSelection):AppendRange[] {
  return mergeAppendRanges(value.ranges??value.indexes.map(index=>[index,index+1]));
}

export function appendSelectedCount(ranges:ReadonlyArray<AppendRange>):number {
  return ranges.reduce((total,[start,end])=>total+end-start,0);
}

export function appendSelectionHas(ranges:ReadonlyArray<AppendRange>,index:number):boolean {
  return ranges.some(([start,end])=>start<=index&&index<end);
}

export function removeAppendRange(ranges:ReadonlyArray<AppendRange>,start:number,end:number):AppendRange[] {
  return ranges.flatMap(([left,right]):AppendRange[]=>{
    if(right<=start||left>=end)return [[left,right]];
    return [...(left<start?[[left,start] as AppendRange]:[]),...(right>end?[[end,right] as AppendRange]:[])];
  });
}

export function equalAppendRanges(left:ReadonlyArray<AppendRange>,right:ReadonlyArray<AppendRange>):boolean {
  return left.length===right.length&&left.every(([start,end],i)=>start===right[i][0]&&end===right[i][1]);
}

export function appendSelectionPayload(ranges:ReadonlyArray<AppendRange>,supportsRanges:boolean):AppendSelection {
  const selected_count=appendSelectedCount(ranges);
  if(!selected_count||ranges.length>APPEND_RANGE_LIMIT)throw new Error("Selection encoding limit");
  if(selected_count<=LEGACY_APPEND_LIMIT){
    const indexes:number[]=[];
    for(const [start,end] of ranges)for(let i=start;i<end;i++)indexes.push(i);
    return {indexes};
  }
  if(!supportsRanges)throw new Error("Reader supports up to 250 selected messages");
  return {ranges:ranges.map(([start,end])=>[start,end]),selected_count};
}
