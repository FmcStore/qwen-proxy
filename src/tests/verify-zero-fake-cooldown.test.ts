import test from "node:test";
import assert from "node:assert/strict";

process.env.TEST_MOCK_QWEN_AUTH = "true";
delete process.env.API_KEY;

import { classifyRetryAction } from "../routes/chat/retry-policy.ts";
import { PersonalizationSyncError } from "../services/qwen.ts";
import {
  markAccountRateLimited,
  getAccountCooldownInfo,
  clearAllAccountCooldowns,
} from "../core/account-manager.ts";

test("PROVA MECANICA: Token expirado nunca mais coloca a conta em cooldown", () => {
  clearAllAccountCooldowns();

  // 1. Simula exatamente o erro do log: Token has expired
  const tokenExpiredErr = new Error("Qwen upstream error: unauthorized: Token has expired, please log in again..");
  const policy = classifyRetryAction(tokenExpiredErr);

  // A policy DEVE ter cooldownMs: 0
  assert.equal(policy.accountCooldownMs, 0, "cooldownMs DEVE ser 0 para token expirado");
  assert.equal(policy.accountCooldownReason, "AuthExpired");

  // Mesmo que tente aplicar no account manager
  markAccountRateLimited("conta-teste-1", policy.accountCooldownMs, policy.accountCooldownReason);
  const info = getAccountCooldownInfo("conta-teste-1");

  // A conta NÃO PODE estar em cooldown
  assert.equal(info, null, "A conta NÃO pode estar em cooldown após token expirado!");
});

test("PROVA MECANICA: Falha de personalizacao nunca mais coloca a conta em cooldown", () => {
  clearAllAccountCooldowns();

  const persErr = new PersonalizationSyncError("Personalization sync failed: timeout after 45s");
  const policy = classifyRetryAction(persErr);

  assert.equal(policy.accountCooldownMs, 0, "cooldownMs DEVE ser 0 para falha de personalizacao");
  assert.equal(policy.accountCooldownReason, "PersonalizationFailed");

  markAccountRateLimited("conta-teste-2", policy.accountCooldownMs, policy.accountCooldownReason);
  const info = getAccountCooldownInfo("conta-teste-2");

  assert.equal(info, null, "A conta NÃO pode estar em cooldown após falha de personalizacao!");
});

test("PROVA MECANICA: Limite real da Alibaba (update_member) CONTINUA sendo respeitado", () => {
  clearAllAccountCooldowns();

  const quotaErr = Object.assign(
    new Error("membership_limit: Qwen upstream membership limit reached (update_member)"),
    { upstreamCode: "membership_limit" }
  );
  const policy = classifyRetryAction(quotaErr);

  assert.ok(policy.accountCooldownMs && policy.accountCooldownMs > 0, "Limite real da Alibaba DEVE ter cooldown positivo");
  assert.equal(policy.accountCooldownReason, "RateLimited");

  markAccountRateLimited("conta-teste-3", policy.accountCooldownMs, policy.accountCooldownReason, { silent: true });
  const info = getAccountCooldownInfo("conta-teste-3");

  assert.ok(info !== null, "A conta DEVE estar em cooldown para o limite real da Alibaba!");
  assert.equal(info?.reason, "RateLimited");
});
