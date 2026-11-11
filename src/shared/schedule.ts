// 이용 시간 설정을 한곳에서 읽어 화면 코드에 넘겨준다: 공휴일(holidays.json)과 쉬는 시간(hours.json). 판정 함수는 hours.ts
import HOLIDAYS_JSON from '../../holidays.json';
import HOURS_JSON from '../../hours.json';
import { parseBreaks, blockMessage } from './hours';

export const HOLIDAYS: Record<string, unknown> = HOLIDAYS_JSON;
export const BREAKS = parseBreaks(HOURS_JSON.breaks);
export const BLOCK_MESSAGE = blockMessage(BREAKS);
