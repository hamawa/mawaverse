// 경마공원 공용 계산 (SPEC "경마공원"). 순수 함수·결정적: 같은 입력이면 어느 화면·생성기·시험에서도 같은 값. 서버 시각은 부르는 쪽이 serverNow() 로 넘긴다.
// 돈에 관계된 값(착순표·배당·마권·결과)은 전부 인기 순위(0 = 1인기, 글자 '0'~'7')로 되어 있다. 마번은 출마표 gateOfRank 로 바꾼다.
//
// derby/time.ts      DERBY_CYCLE_MS · DERBY_SALE_MS · DERBY_PHASES, raceNo(ms), cycleStart(n), derbyPhase(ms), saleProgress(ms),
//                    raceScheduled(n, cfg, env), raceSaleOpen(ms, cfg, env), nextScheduledRace(ms, cfg, env), derbyStatusText(ms, cfg, env)
// derby/stable.ts    derbyWeek(ms), derbyWeekStart(w), derbyHorse(w, i), derbyHorseById(id), derbyRoster(week), derbyRosterAt(ms),
//                    derbyRetirements(week), derbyDebuts(week), derbyForm(horse, week), DERBY_JOCKEYS, derbyTrack(ms), derbyCard(n)
// derby/odds.ts      DERBY_PROFILES, derbyTable(p), derbyBaseEntry(p, i), derbyOdds(p, t, s1, s2), derbyOddsTable(p), comboKey, derbyCombos,
//                    oddsFromCount(count), poolOddsX10(total, amount), derbyPoolsFor(p, seed, progress)
// derby/scenario.ts  DERBY_BEHAVIORS, behaviorRates(p, r, k), buildSlots(p, list), derbyScenario(s), derbyScenarioFor(n), derbyAllowedBehaviors(p),
//                    applyDerbyEvent(top4, e, r), pickDerbyEvent(slots, ev), outcomeDist(p, slots), ticketProbs(dist), maxTicketEV(p, slots),
//                    derbyResolve(n, digits7) → { res: {a,b,c,e}, order, fall, … }
// derby/tickets.ts   expandSelection(sel), ticketRecord(tk, a), ticketWins(tk, res), raceOdds(n, t, s1, s2), ticketPayout(a, odds), ticketKey(n, nn),
//                    validTicketAmount(a), derbyPools(n, progress), 한도 상수 DERBY_TICKET_MIN · STEP · MAX_PARK · MAX_BRANCH · TICKETS_PER_RACE
// derby/data.ts      derbyStaticData() (raceData/ 공개 고정 자료: sc · odds. 자료 모양은 그 파일 머리말)
// derby/secret.ts    숨은 결과표 칸 derbySecretEntry(n, digits7), 공개 칸 읽기 parseDerbyDraw(v), 2진수 앞자리 derbyBitMayBeOne · derbyBitsDigits
export * from './derby/time';
export * from './derby/stable';
export * from './derby/odds';
export * from './derby/scenario';
export * from './derby/tickets';
export * from './derby/data';
export * from './derby/secret';
