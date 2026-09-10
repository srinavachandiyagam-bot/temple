/**
 * Append-only registration audit log helper.
 *
 * Centralizes INSERTs into registration_audit_log so every lifecycle event
 * (CREATED, payment changes, ARCHIVED) is recorded identically from routes,
 * controllers, and transactions.
 *
 * `exec` may be the shared `query` function or a transaction client's
 * `query` method. Callers must wrap multi-statement flows (UPDATE + INSERT)
 * in BEGIN/COMMIT so the state change and its audit event are atomic.
 *
 * There is intentionally NO update/delete helper here: the audit log is
 * append-only at the application level (plus DB-level guards). History can
 * be added to and read, never altered or purged through the application.
 */

async function appendAuditEvent(exec, event) {
  const {
    registration_db_id,
    registration_id,
    action,
    actor_admin_id = null,
    actor_username = null,
    reason = null,
    snapshot = {}
  } = event || {};

  if (!Number.isInteger(Number(registration_db_id))) {
    throw new Error('audit event requires registration_db_id');
  }
  if (!registration_id) {
    throw new Error('audit event requires registration_id');
  }
  if (!action) {
    throw new Error('audit event requires action');
  }

  const result = await exec(
    `INSERT INTO registration_audit_log
       (registration_db_id, registration_id, action, actor_admin_id, actor_username, reason, snapshot_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      Number(registration_db_id),
      registration_id,
      action,
      actor_admin_id === undefined ? null : actor_admin_id,
      actor_username === undefined ? null : actor_username,
      reason === undefined ? null : reason,
      typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot || {})
    ]
  );
  return result;
}

module.exports = {
  appendAuditEvent
};
