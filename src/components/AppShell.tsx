import { NavLink, Outlet } from "react-router-dom";
import { CalendarIcon, HomeIcon, SettingsIcon, UsersIcon } from "./icons";
import AccountBar from "./AccountBar";
import GoogleStatus from "./GoogleStatus";

/**
 * Quattro voci: abbastanza per orientarsi, poche per non far accavallare le
 * icone sul telefono. Le relazioni si raggiungono dall'anagrafica e dal pannello,
 * quindi non occupano un'icona tutta loro.
 */
const NAV = [
  { to: "/panel", label: "Home", icon: HomeIcon, end: true },
  { to: "/panel/anagrafici", label: "Anagrafici", icon: UsersIcon, end: false },
  { to: "/panel/appuntamenti", label: "Appuntamenti", icon: CalendarIcon, end: false },
  { to: "/panel/impostazioni", label: "Impostazioni", icon: SettingsIcon, end: false },
];

export default function AppShell() {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
      <aside className="sticky top-6 hidden h-fit w-60 shrink-0 flex-col gap-1 lg:flex">
        <div className="mb-6 px-2">
          <p className="font-display text-2xl leading-none">Reportini</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-ink-400">
            Anagrafici &amp; appuntamenti
          </p>
        </div>
        {NAV.map(({ to, label, icon: Icona, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-ink-950 text-white shadow-soft"
                  : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              }`
            }
          >
            <Icona className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
        <div className="mt-6">
          <GoogleStatus compatto />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <AccountBar />
        <GoogleStatus />
        <Outlet />
      </main>

      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 backdrop-blur lg:hidden"
        aria-label="Navigazione principale"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2 pt-2">
          {NAV.map(({ to, label, icon: Icona, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 rounded-xl py-1.5 transition-colors ${
                    isActive ? "text-ink-950" : "text-ink-400"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden={isActive}
                      className={`grid h-8 w-12 place-items-center rounded-full transition-colors ${
                        isActive ? "bg-ink-950 text-white" : "text-ink-400"
                      }`}
                    >
                      <Icona className="h-[18px] w-[18px]" />
                    </span>
                    {/* L'etichetta compare solo sulla voce attiva: la barra
                        resta tersa e si muove mentre ci si sposta. */}
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide transition-opacity"
                      aria-current={isActive ? "page" : undefined}
                    >
                      {isActive ? label : <span className="invisible">{label}</span>}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
