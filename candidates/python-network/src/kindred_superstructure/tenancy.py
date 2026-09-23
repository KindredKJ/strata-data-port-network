"""Organization-first Kindred One tenant authority and isolation controls."""
from __future__ import annotations
from .persistence import SQLiteState

class TenantDirectory:
    def __init__(self,state:SQLiteState): self.state=state; self._migrate()
    def _migrate(self):
        with self.state.transaction() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS organizations(organization_id TEXT PRIMARY KEY,partner_id TEXT NOT NULL,display_name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tenants(tenant_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(organization_id),environment_id TEXT NOT NULL,brand_context TEXT NOT NULL,UNIQUE(organization_id,environment_id));
            CREATE TABLE IF NOT EXISTS entitlements(entitlement_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),capability TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','suspended','revoked')));
            """)
    def onboard(self,organization_id,partner_id,display_name):
        if not all((organization_id,partner_id,display_name)): raise ValueError("organization context required")
        with self.state.transaction() as db: db.execute("INSERT INTO organizations VALUES(?,?,?)",(organization_id,partner_id,display_name))
    def provision(self,tenant_id,organization_id,environment_id,brand_context):
        with self.state.transaction() as db: db.execute("INSERT INTO tenants VALUES(?,?,?,?)",(tenant_id,organization_id,environment_id,brand_context))
    def grant(self,entitlement_id,tenant_id,capability):
        with self.state.transaction() as db: db.execute("INSERT INTO entitlements VALUES(?,?,?,'active')",(entitlement_id,tenant_id,capability))
    def authorize(self,organization_id,tenant_id,entitlement_id,capability)->bool:
        row=self.state.connection.execute("SELECT 1 FROM tenants t JOIN entitlements e ON e.tenant_id=t.tenant_id WHERE t.organization_id=? AND t.tenant_id=? AND e.entitlement_id=? AND e.capability=? AND e.state='active'",(organization_id,tenant_id,entitlement_id,capability)).fetchone()
        return row is not None
