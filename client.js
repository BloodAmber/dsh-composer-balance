window.__ModuleLoader__.load({
  id: '@local/composer-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'composer.balance';

    /**
     * DeepSeek list prices in CNY for one million tokens. A session's cost is the
     * only estimate this pill can make: the Host bills account credits itself and
     * exposes no per-session price, so the figure is derived from the durable
     * `tokenUsage` projection. Adjust these three numbers to match your plan.
     */
    const PRICE = { cacheMiss: 2, cacheHit: 0.2, output: 3 };

    /** Read interval for the account balance while a pill is on screen. */
    const REFRESH_MS = 60000;
    /** A remount inside this window reuses the last balance read instead of asking again. */
    const FRESH_MS = 20000;

    const EN = {
      'pill.spent': 'Spent ≈{amount}',
      'pill.left': 'Left {amount}',
      'pill.leftUnknown': 'Left —',
      'pill.separator': '·',
      'pill.refresh': 'Refresh the account balance',
      'pill.hint':
        'Estimated from this session\'s tokens at ¥{miss}/M input, ¥{hit}/M cached input and ¥{out}/M output. The remaining balance comes from your DeepSeek account and refreshes every minute; click to refresh now.',
    };
    const ZH = {
      'pill.spent': '消耗 ≈{amount}',
      'pill.left': '剩余 {amount}',
      'pill.leftUnknown': '剩余 —',
      'pill.separator': '·',
      'pill.refresh': '刷新账户余额',
      'pill.hint':
        '按本次会话的 token 估算：输入 ¥{miss}/百万、缓存命中 ¥{hit}/百万、输出 ¥{out}/百万。剩余余额取自 DeepSeek 账户，每分钟刷新一次，点击可立即刷新。',
    };

    /** Insert digit grouping into a plain decimal string. */
    function grouped(text) {
      const [whole, fraction] = text.split('.');
      const head = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return fraction === undefined ? head : `${head}.${fraction}`;
    }

    /** Balance amounts follow the account card: two decimals, sub-cent shown as <0.01. */
    function formatBalance(amount) {
      const value = Number(amount);
      if (!Number.isFinite(value)) return null;
      const magnitude = Math.abs(value);
      if (magnitude > 0 && magnitude < 0.01) return value < 0 ? '>-0.01' : '<0.01';
      return `${value < 0 ? '-' : ''}${grouped(magnitude.toFixed(2))}`;
    }

    /** Cost keeps more precision while the session is cheap. */
    function formatCost(value) {
      if (!Number.isFinite(value) || value <= 0) return '0.00';
      if (value < 0.01) return value.toFixed(4);
      if (value < 1) return value.toFixed(3);
      return grouped(value.toFixed(2));
    }

    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥';
      if (currency === 'USD') return '$';
      return `${currency} `;
    }

    /** Fold one wallet into its display text, or null when the amount is unusable. */
    function walletText(wallet) {
      if (wallet === null || typeof wallet !== 'object') return null;
      const amount = formatBalance(wallet.balance);
      if (amount === null) return null;
      return `${currencySymbol(wallet.currency)}${amount}`;
    }

    /** Sum the durable whole-log token usage into CNY at PRICE. */
    function costOf(usage) {
      if (usage === null || typeof usage !== 'object') return null;
      const cacheMiss = Number(usage.uncachedInputTokens) || 0;
      const cacheHit = Number(usage.cacheReadTokens) || 0;
      const cacheWrite = Number(usage.cacheWriteTokens) || 0;
      const output = Number(usage.outputTokens) || 0;
      if (cacheMiss + cacheHit + cacheWrite + output === 0) return 0;
      return (
        (cacheMiss * PRICE.cacheMiss +
          (cacheHit + cacheWrite) * PRICE.cacheHit +
          output * PRICE.output) /
        1000000
      );
    }

    /** Client identity the account Remote methods carry; a rejected version must not break the pill. */
    function clientVersion() {
      const boot = globalThis.__DSH_BOOT__;
      const release = boot && typeof boot === 'object' ? boot.release : undefined;
      const version = release && typeof release === 'object' ? release.version : undefined;
      return typeof version === 'string' && version !== '' ? version : '0.2.1-rc.2';
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'composer-balance: dictionaries');
        const bound = ctx.locale.bind(NS);

        let state = {
          status: 'idle',
          wallets: [],
          bonusWallets: [],
          readAt: 0,
        };
        const listeners = new Set();
        const publish = (next) => {
          state = next;
          for (const listener of listeners) listener();
        };
        const subscribe = (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        };
        const getSnapshot = () => state;

        let inflight = null;
        let lastAttempt = 0;

        const read = () => {
          if (inflight !== null) return inflight;
          lastAttempt = Date.now();
          const pending = Promise.resolve()
            .then(() =>
              ctx.remote.account.getBalance({
                version: clientVersion(),
                locale: ctx.locale.getSnapshot().active,
                timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
              }),
            )
            .then((result) => {
              const value = result && result.ok === true ? result.value : undefined;
              if (value !== undefined && value !== null && value.status === 'ready') {
                publish({
                  status: 'ready',
                  wallets: Array.isArray(value.value) ? value.value : [],
                  bonusWallets: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
                  readAt: Date.now(),
                });
              } else {
                publish({ ...state, status: 'unavailable', readAt: state.readAt });
              }
            })
            .catch(() => {
              publish({ ...state, status: 'unavailable', readAt: state.readAt });
            })
            .then(() => {
              if (inflight === pending) inflight = null;
            });
          inflight = pending;
          return pending;
        };

        /** Read unless a fresh answer already arrived or a read is still in flight. */
        const ensureFresh = (force) => {
          if (inflight !== null) return;
          const now = Date.now();
          if (!force) {
            if (state.status === 'ready' && now - state.readAt < FRESH_MS) return;
            if (state.status !== 'idle' && now - lastAttempt < FRESH_MS) return;
          }
          read();
        };

        const balanceStore = { subscribe, getSnapshot };

        function BalancePill(props) {
          const t = typeof props.t === 'function' ? props.t : bound;
          const usage = props.useProjection('tokenUsage');
          const store = props.balanceStore || balanceStore;
          const balance = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
          const refresh = props.refreshBalance || ensureFresh;
          const [hover, setHover] = React.useState(false);

          React.useEffect(() => {
            refresh();
            const timer = setInterval(() => refresh(), REFRESH_MS);
            return () => clearInterval(timer);
          }, [refresh]);

          const cost = costOf(usage);
          const spent = cost !== null && cost > 0;
          const amounts = (balance.wallets || []).map(walletText).filter((text) => text !== null);
          const available = amounts.length > 0 ? amounts.join(' / ') : null;
          if (!spent && available === null) return null;

          const spentText = spent ? t('pill.spent', { amount: `¥${formatCost(cost)}` }) : null;
          const leftText = available === null ? t('pill.leftUnknown') : t('pill.left', { amount: available });
          const separator = t('pill.separator');
          const aria = spentText === null ? leftText : `${spentText} ${separator} ${leftText}`;
          const hint = t('pill.hint', { miss: PRICE.cacheMiss, hit: PRICE.cacheHit, out: PRICE.output });

          return h(
            'button',
            {
              type: 'button',
              title: `${aria}\n${hint}`,
              'aria-label': `${aria} · ${t('pill.refresh')}`,
              onMouseEnter: () => setHover(true),
              onMouseLeave: () => setHover(false),
              onClick: () => refresh(true),
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxSizing: 'border-box',
                border: 0,
                borderRadius: 'var(--dsw-radius-sm)',
                padding: '1px 8px',
                background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                color: hover ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)',
                font: 'inherit',
                fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
                lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 14,
                height: 14,
                'aria-hidden': true,
                style: { flex: 'none' },
              },
              h('path', {
                d: 'M2.5 4.75A2.25 2.25 0 0 1 4.75 2.5h6.5a1 1 0 0 1 0 2h-6.5a.75.75 0 0 0-.75.75v5.5a.75.75 0 0 0 .75.75h7.5a.75.75 0 0 0 .75-.75V8.5',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.3,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
              h('rect', {
                x: 8.5,
                y: 6,
                width: 5.5,
                height: 4,
                rx: 1,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.3,
              }),
              h('circle', { cx: 11.25, cy: 8, r: 0.8, fill: 'currentColor' }),
            ),
            spentText !== null ? h('span', { children: spentText }) : null,
            spentText !== null ? h('span', { 'aria-hidden': true, children: separator }) : null,
            h('span', { children: leftText }),
          );
        }

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'balance',
              order: 2,
              locale: NS,
              inject: () => ({ balanceStore, refreshBalance: ensureFresh }),
            },
            BalancePill,
          ),
        );
      },
    };
  },
});
