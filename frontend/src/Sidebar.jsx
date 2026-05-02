import { useState } from "react";
import { Plus, Trash2, X, Sparkles, LogOut, BarChart3 } from "lucide-react";

const MAX_SESSIONS = 5;

export default function Sidebar({
  sessions,
  activeId,
  onPick,
  onNew,
  onDelete,
  onSignOut,
  onCompare,
  open,
  onClose,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const atLimit = sessions.length >= MAX_SESSIONS;

  return (
    <>
      {/* mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`glass fixed left-0 top-0 z-40 flex h-screen w-72 flex-col border-r border-white/10 transition-transform md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="accent-bg accent-glow grid h-8 w-8 place-items-center rounded-xl">
              <Sparkles size={14} className="text-slate-900" />
            </div>
            <span className="serif text-xl">AuraGo</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/[0.06] md:hidden"
            aria-label="Close sidebar"
          >
            <X size={14} />
          </button>
        </div>

        {/* new trip */}
        <div className="px-3 pt-3">
          <button
            onClick={() => {
              if (atLimit) return;
              onNew();
              onClose?.();
            }}
            disabled={atLimit}
            className="accent-bg accent-glow flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} /> New trip
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            {sessions.length}/{MAX_SESSIONS} trips
            {atLimit && " · delete one to add more"}
          </p>
        </div>

        {/* list */}
        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              No trips yet. Click "New trip" to start.
            </p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => {
                const isActive = s.id === activeId;
                const confirming = confirmDeleteId === s.id;
                return (
                  <li key={s.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-xl border px-2 py-2 transition ${
                        isActive
                          ? "accent-border accent-soft-bg"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                      }`}
                    >
                      <button
                        onClick={() => { onPick(s.id); onClose?.(); }}
                        className="flex-1 truncate text-left"
                      >
                        <div className={`text-[13px] font-medium ${isActive ? "text-slate-100" : "text-slate-200"}`}>
                          {s.title || "New Trip"}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">
                          {s.mode ?? "elite"} · ₹{(s.budget_inr ?? 0).toLocaleString("en-IN")}
                        </div>
                      </button>
                      {confirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => {
                              setConfirmDeleteId(null);
                              await onDelete(s.id);
                            }}
                            className="rounded-md border border-red-400/30 bg-red-400/[0.08] px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-400/[0.16]"
                            title="Confirm delete"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.06]"
                            title="Cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-red-300 opacity-0 group-hover:opacity-100"
                          title="Delete trip"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* footer */}
        <div className="space-y-2 border-t border-white/[0.06] px-3 py-3">
          <button
            onClick={() => { onCompare?.(); onClose?.(); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
          >
            <BarChart3 size={12} /> Compare locked trips
          </button>
          <button
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

export { MAX_SESSIONS };
