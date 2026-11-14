/** Explicit schema identity registry. Business keys, tokens and historical JSON are deliberately excluded. */
export const entityTables = ['users','companies','factories','partners','warehouses','locations','units','material_categories','materials','material_factory_policies','audit_logs','factory_calendars','calendar_week_patterns','work_centers','numbering_rules','numbering_counters','number_allocations'] as const;
export type EntityTable = typeof entityTables[number];
export const resourceTables:Record<string,EntityTable> = {
 users:'users',companies:'companies',factories:'factories',partners:'partners',warehouses:'warehouses',locations:'locations',units:'units','material-categories':'material_categories',materials:'materials','factory-calendars':'factory_calendars','work-centers':'work_centers','numbering-rules':'numbering_rules','number-allocations':'number_allocations',
};
export const referenceTables:Record<string,Record<string,EntityTable>> = {
 users:{}, sessions:{user_id:'users'}, companies:{created_by:'users',updated_by:'users'},
 factories:{company_id:'companies',created_by:'users',updated_by:'users'},
 partners:{company_id:'companies',created_by:'users',updated_by:'users'},partner_roles:{partner_id:'partners'},
 warehouses:{company_id:'companies',factory_id:'factories',custodian_supplier_id:'partners',created_by:'users',updated_by:'users'},
 locations:{company_id:'companies',factory_id:'factories',warehouse_id:'warehouses',created_by:'users',updated_by:'users'},
 units:{created_by:'users',updated_by:'users'},material_categories:{company_id:'companies',parent_id:'material_categories',created_by:'users',updated_by:'users'},
 materials:{company_id:'companies',category_id:'material_categories',base_unit_id:'units',created_by:'users',updated_by:'users'},
 material_units:{material_id:'materials',unit_id:'units'},
 material_factory_policies:{company_id:'companies',material_id:'materials',factory_id:'factories',preferred_supplier_id:'partners'},
 material_inspection_policies:{policy_id:'material_factory_policies'},
 user_company_scopes:{user_id:'users',company_id:'companies'},user_factory_scopes:{user_id:'users',factory_id:'factories'},
 audit_logs:{actor_id:'users',company_id:'companies',factory_id:'factories'},
 factory_calendars:{company_id:'companies',factory_id:'factories',created_by:'users',updated_by:'users'},
 calendar_week_patterns:{calendar_id:'factory_calendars'},calendar_exceptions:{calendar_id:'factory_calendars'},
 work_centers:{company_id:'companies',factory_id:'factories',created_by:'users',updated_by:'users'},
 numbering_rules:{company_id:'companies',factory_id:'factories',created_by:'users',updated_by:'users'},
 numbering_counters:{company_id:'companies',factory_id:'factories'},
 number_allocations:{company_id:'companies',factory_id:'factories',rule_id:'numbering_rules',created_by:'users'},
 number_allocation_items:{allocation_id:'number_allocations',company_id:'companies'},
};
export const compositeTables = ['sessions','partner_roles','material_units','material_inspection_policies','user_company_scopes','user_factory_scopes','calendar_exceptions','number_allocation_items'] as const;
export const auditEntityTables:Record<string,EntityTable> = {...resourceTables,'material_factory_policies':'material_factory_policies','calendar_week_patterns':'calendar_week_patterns','numbering_counters':'numbering_counters'};
