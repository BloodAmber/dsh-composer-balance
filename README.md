# DSH Composer Balance

A DeepSeek Harness Web UI plugin that adds **balance spent** and **remaining account balance**
next to the token meter under the message composer:

```
消耗 ≈¥0.012 · 剩余 ¥12.34
```

- **Spent** — an estimate for the current Session, derived from the durable `tokenUsage`
  projection (cache-miss input, cache-hit input, output — plus cache writes).
- **Left** — the remaining DeepSeek account balance, read through the account Remote namespace
  (`ctx.remote.account.getBalance`). These are the same recharge wallets Settings → Account shows.

The pill refreshes the balance once a minute while it is on screen, and immediately on click.
Hovering it explains the estimate. English and Chinese copy follow the interface language.

## Install

The plugin is a standard Harness bundle. Install it from this directory with the Plugin Manager
bundle install action (`plugin_manager` → `install_bundle`), pointing at the repository checkout:

```
install_bundle  target: <absolute path to this checkout>
```

Installing registers one row in the current profile and loads the Client module into the Web page;
reload the page if the pill does not appear. Because the bundle is installed from a linked
directory, editing `client.js` afterwards needs a re-install (or a fresh graph publication) to reach
the browser.

Requirements: DeepSeek Harness with the `deepseek-account` composition (the standard Desktop/Web
profile has it), and a signed-in DeepSeek account for the balance. Without an account the pill shows
`剩余 —` while the spent estimate still works.

## Estimates, not billing

The Host bills account credits itself and exposes no per-Session price, so the spent figure is an
estimate at these list prices (CNY per one million tokens), defined at the top of `client.js`:

| Bucket | Price |
| --- | --- |
| Input, cache miss | ¥2 |
| Input, cache hit (and cache write) | ¥0.2 |
| Output | ¥3 |

Change `PRICE` in `client.js` to match another plan. The figure is always prefixed with `≈`.

## How it works

| File | Role |
| --- | --- |
| `client.js` | Browser module: registers `balance` (order 2) into `conversation.composer.dock`, owns the locale dictionary, formats amounts, reads the balance, polls once a minute |
| `index.js` | Host half — intentionally empty; the capability is client-only |
| `cordis.patch.yml` | Inserts the bundle row into the profile |
| `locale/*.json` | Plugin Manager display metadata (title, description) |
| `icon.svg` | Plugin icon |

The pill is a `<button>` styled only with Harness theme tokens, so it follows light/dark appearance.
It reuses the shipped pill metrics from `dsh-client-ui-chat`'s stats pills without importing that
package.

## 中文说明

在输入框下方的 token 统计右侧新增一个胶囊：`消耗 ≈¥0.012 · 剩余 ¥12.34`。

- 「消耗」按本会话的 token 用量与价目表估算（Host 不对外暴露单会话价格，因此只能是估算）。
- 「剩余」来自 DeepSeek 账户余额，与设置 → 账户中的充值余额一致；每分钟刷新，点击可立即刷新。
- 未登录账户时显示 `剩余 —`，消耗估算照常工作。

## License

MIT — see [LICENSE](LICENSE).
