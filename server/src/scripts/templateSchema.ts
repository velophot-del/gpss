export async function createTemplateContractTables(conn: any) {
  await conn.query(`CREATE TABLE IF NOT EXISTS document_template_contracts (
    template_id VARCHAR(36) PRIMARY KEY,
    profile JSON NOT NULL,
    confirmed_at DATETIME NULL,
    confirmed_by VARCHAR(36) NULL,
    FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await conn.query(`CREATE TABLE IF NOT EXISTS document_material_templates (
    document_type VARCHAR(20) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    template_id VARCHAR(36) NOT NULL,
    profile JSON NOT NULL,
    field_values JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_type, record_id),
    FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}
