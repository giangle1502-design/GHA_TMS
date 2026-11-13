import type { EntityDef } from "./types";

export type EntityAccess = { view: boolean; create: boolean; update: boolean; delete: boolean; export: boolean; import: boolean; configureFields: boolean };

/** Quyền thao tác trên một thực thể, khớp với RLS trong CSDL (CSDL vẫn là lớp kiểm tra cuối). */
export function entityAccess(entity: EntityDef, perms: Set<string>): EntityAccess {
  const has = (a: string) => perms.has(`${entity.perm}.${a}`);
  const sensitiveOk = !entity.sensitive || has("view_sensitive");
  const view = (has("view") || Boolean(entity.viewAnyOf?.some((p) => perms.has(p)))) && sensitiveOk;
  const create =
    sensitiveOk && ((entity.writeAsUpdate ? has("update") : has("create")) || Boolean(entity.createAnyOf?.some((p) => perms.has(p))));
  const update = sensitiveOk && has("update");
  const del = !entity.noDelete && sensitiveOk && (entity.writeAsUpdate ? has("update") : has("delete"));
  const exp = view && (entity.hasExport ? has("export") : true);
  if (entity.openToAll) {
    return { view: true, create: Boolean(entity.createAction) && (!entity.createPerm || perms.has(entity.createPerm)), update: false, delete: false, export: true, import: false, configureFields: Boolean(entity.customModule) && perms.has("fields.configure") };
  }
  if (entity.writePerm) {
    const w = sensitiveOk && perms.has(entity.writePerm);
    return { view, create: w, update: w, delete: w && !entity.noDelete, export: exp, import: w && Boolean(entity.importable) && !entity.parentKey, configureFields: Boolean(entity.customModule) && perms.has("fields.configure") };
  }
  if (entity.readOnlyRows) {
    return {
      view,
      create: Boolean(entity.createAction) && sensitiveOk && (entity.createPerm ? perms.has(entity.createPerm) : has("create")),
      update: false,
      delete: false,
      export: exp,
      import: false,
      configureFields: Boolean(entity.customModule) && perms.has("fields.configure"),
    };
  }
  return {
    view,
    create,
    update,
    delete: del,
    export: exp,
    import: create && !entity.parentKey && !entity.singleton,
    configureFields: Boolean(entity.customModule) && perms.has("fields.configure"),
  };
}
