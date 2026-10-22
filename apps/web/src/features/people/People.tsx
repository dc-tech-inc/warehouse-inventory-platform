import { can, type Employee, type RewardItem, type Role } from "@app/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { formatDate, formatDateTime, formatNumber } from "../../format";
import { useAction, useLoad, type Loadable } from "../../hooks";
import { Data, FormError, Pager } from "../../ui";

const PAGE = 10;

export function People({ role }: { role: Role }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Employee | null>(null);
  const showEmployees = can(role, "employees:read");
  const employees = useLoad(`employees|${showEmployees}|${offset}`, () =>
    showEmployees ? api.employees({ limit: PAGE, offset }) : Promise.resolve({ items: [] as Employee[], total: 0 }),
  );
  const board = useLoad("leaderboard", () => api.leaderboard());
  const catalog = useLoad("catalog", () => api.rewardCatalog());

  const refresh = () => {
    employees.reload();
    board.reload();
  };

  return (
    <div className="stack">
      <p className="muted small">All people on this page are synthetic demo data.</p>
      <div className="two-col">
        {showEmployees && (
          <section aria-labelledby="h-emp">
            <h2 id="h-emp">Employees</h2>
            <Data state={employees.state} empty="No employees." isEmpty={(p) => p.items.length === 0}>
              {(page) => (
                <>
                  <table>
                    <thead><tr><th>Name</th><th>Department</th><th>Since</th><th className="r">Points</th><th><span className="sr-only">Open</span></th></tr></thead>
                    <tbody>
                      {page.items.map((e) => (
                        <tr key={e.id} className={selected?.id === e.id ? "selected" : undefined}>
                          <td>{e.name}<div className="muted small">{e.title}</div></td>
                          <td>{e.department}</td>
                          <td className="muted">{formatDate(e.hiredOn)}</td>
                          <td className="r num">{formatNumber(e.points)}</td>
                          <td className="r"><button type="button" className="ghost" onClick={() => setSelected(e)}>Rewards</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pager offset={offset} limit={PAGE} total={page.total} onChange={setOffset} />
                </>
              )}
            </Data>
          </section>
        )}

        <section aria-labelledby="h-board">
          <h2 id="h-board">Recognition board</h2>
          <Data state={board.state} empty="No points awarded yet." isEmpty={(b) => b.length === 0}>
            {(items) => (
              <ol className="board">
                {items.map((e) => (
                  <li key={e.id}><span>{e.name}</span><span className="num">{formatNumber(e.points)}</span></li>
                ))}
              </ol>
            )}
          </Data>
        </section>
      </div>

      {selected && (
        <EmployeeRewards
          key={selected.id}
          employee={selected}
          canAward={can(role, "rewards:award")}
          rewards={catalog}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function EmployeeRewards({
  employee,
  canAward,
  rewards,
  onChanged,
}: {
  employee: Employee;
  canAward: boolean;
  rewards: { state: Loadable<RewardItem[]> };
  onChanged: () => void;
}) {
  const ledger = useLoad(`ledger|${employee.id}`, () => api.employeeRewards(employee.id));
  const [points, setPoints] = useState("10");
  const [reason, setReason] = useState("");
  const award = useAction();
  const redeem = useAction();

  async function submitAward(event: FormEvent) {
    event.preventDefault();
    if (await award.run(() => api.award(employee.id, { points: Number(points), reason }))) {
      setReason("");
      ledger.reload();
      onChanged();
    }
  }

  return (
    <section className="panel" aria-labelledby="h-ledger">
      <h2 id="h-ledger">{employee.name}: reward ledger</h2>
      <Data state={ledger.state} empty="">
        {(l) => (
          <>
            <p>Balance: <strong className="num">{formatNumber(l.balance)}</strong> points</p>
            {l.entries.length === 0 ? (
              <p className="muted">No entries yet.</p>
            ) : (
              <table>
                <thead><tr><th>When</th><th>Reason</th><th className="r">Points</th></tr></thead>
                <tbody>
                  {l.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{formatDateTime(e.createdAt)}</td>
                      <td>{e.reason}</td>
                      <td className={`r num ${e.points < 0 ? "neg" : "pos"}`}>{e.points > 0 ? `+${e.points}` : e.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Data>

      {canAward && (
        <div className="two-col">
          <form className="form-grid" onSubmit={submitAward}>
            <h3>Award points</h3>
            <label>Points<input type="number" min={1} max={1000} step={1} required value={points} onChange={(e) => setPoints(e.target.value)} /></label>
            <label>Reason<input required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <FormError message={award.error} />
            <button type="submit" className="primary" disabled={award.busy}>{award.busy ? "Awarding…" : "Award"}</button>
          </form>
          <div className="form-grid">
            <h3>Redeem</h3>
            <Data state={rewards.state} empty="The catalog is empty." isEmpty={(c) => c.length === 0}>
              {(items) => (
                <ul className="catalog">
                  {items.map((r) => (
                    <li key={r.id}>
                      <span>{r.name}</span>
                      <span className="num muted">{formatNumber(r.pointsCost)} pts</span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={redeem.busy}
                        onClick={() => void redeem.run(() => api.redeem(employee.id, r.id)).then((ok) => { if (ok) { ledger.reload(); onChanged(); } })}
                      >
                        Redeem
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Data>
            <FormError message={redeem.error} />
          </div>
        </div>
      )}
    </section>
  );
}
