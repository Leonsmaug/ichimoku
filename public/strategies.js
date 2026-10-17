// De to måtene å finne kjøpssignal på. Felles for nettsiden og workeren.
import { analyze as analyzeIchimoku } from './ichimoku.js';
import { analyzeCombo } from './indicators.js';

export const STRATEGIES = {
  ichimoku: {
    label: 'Ichimoku',
    long: 'Ichimoku-sky',
    analyze: (candles) => {
      const r = analyzeIchimoku(candles);
      if (r.status) r.status.max = 4;
      return r;
    },
    text: { sterk: 'Sterkt kjøpssignal', svak: 'Svakt kjøpssignal', over: 'Over skyen', noytral: 'I skyen', under: 'Under skyen' },
  },
  combo: {
    label: 'CCI + BB + MACD',
    long: 'CCI, Bollinger Bands og MACD',
    analyze: analyzeCombo,
    text: { sterk: 'Sterkt kjøpssignal', svak: 'Svakt kjøpssignal', over: 'Positiv trend', noytral: 'Nøytral', under: 'Negativ trend' },
  },
};

export const strategyOf = (name) => STRATEGIES[name] || STRATEGIES.ichimoku;
