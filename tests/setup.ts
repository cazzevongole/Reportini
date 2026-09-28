// React 18 richiede questo flag per funzionare correttamente dentro act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export {};
