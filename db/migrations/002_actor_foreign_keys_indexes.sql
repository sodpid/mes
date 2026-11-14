-- LIKE copies CHECK/NOT NULL, but PostgreSQL does not copy foreign keys.
ALTER TABLE factories ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE partners ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE warehouses ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE locations ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE units ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE material_categories ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
ALTER TABLE materials ADD FOREIGN KEY(created_by) REFERENCES users, ADD FOREIGN KEY(updated_by) REFERENCES users;
CREATE INDEX ON factories(company_id,status);
CREATE INDEX ON warehouses(company_id,factory_id,status);
CREATE INDEX ON locations(warehouse_id,status);
CREATE INDEX ON partners(company_id,status);
CREATE INDEX ON material_categories(company_id,parent_id);
CREATE INDEX ON materials(company_id,status);
CREATE INDEX ON material_factory_policies(factory_id,status);
