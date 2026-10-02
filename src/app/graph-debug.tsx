import { StatusBar } from "expo-status-bar";
import { Check, Play, RotateCcw, SkipForward } from "lucide-react-native";
import { type ReactNode, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProgressBar } from "@/components/ui/misc";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Tap } from "@/components/ui/Tap";
import { T } from "@/components/ui/Text";
import { EXAMPLE_BOARDS } from "@/data/examples";
import { interestById } from "@/data/interests";
import { describeActivity, editionOrder } from "@/graph/agent";
import { INTELLIGENCE, MATCH, SIGNALS } from "@/graph/config";
import { describe, type Opportunity } from "@/graph/signals";
import { DEMO_IDS, DEMO_STEPS } from "@/graph/demo";
import { buildHappeningGraph } from "@/graph/happening";
import {
  buildHappening,
  negativeFeedback,
  rankBuzz,
  rankDrift,
} from "@/graph/surfaces";
import { buildEdition } from "@/graph/worlds";
import { ME_NODE } from "@/graph/graph";
import { loopProgress } from "@/graph/loops";
import {
  crushEligibility,
  crushEligible,
  isActiveLoop,
  RELATIONSHIP_LABEL,
  rankBoards,
  rankMoves,
  rankPeopleCtx,
  rankStories,
} from "@/graph/relevance";
import { useGraphCtx } from "@/hooks/useGraph";
import { repo } from "@/services/repository";
import { useChimp } from "@/store/useChimp";
import { useExposure } from "@/store/useExposure";
import { useSession } from "@/store/useSession";
import { colors, radius } from "@/theme";
import type { HappeningItem, Scored } from "@/types/models";

/**
 * Graph Debug — development only (reached from Settings when running in
 * dev). Shows the numbers behind the behaviour layer: affinities,
 * relationships, loops, change events and top recommendations with scores
 * and reasons. Consumer screens never show raw scores.
 */
/** Phase 6D: developer accounts (server-decided) and the Demo account only. */
export default function GraphDebugScreen() {
  // App Review Demo: no developer tools (it is opened without any account).
  const allowed = useSession((x) => x.developer || (x.mode === "demo" && !x.reviewDemo));
  if (!allowed)
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Graph Debug" />
        <T v="subhead" color={colors.inkMuted} weight="400" style={{ padding: 20 }}>
          Developer tools are only available to developer accounts.
        </T>
      </SafeAreaView>
    );
  return <GraphDebugBody />;
}

function GraphDebugBody() {
  const ctx = useGraphCtx();
  const st = useChimp();
  const { s, g } = ctx;
  const baseline = st.baseline;

  const boards = useMemo(
    () => rankBoards(ctx, (b) => b.ownerId !== repo.meId()),
    [ctx],
  );
  const moves = useMemo(() => rankMoves(ctx), [ctx]);
  const stories = useMemo(
    () => rankStories(ctx, (x) => x.lane === "trending"),
    [ctx],
  );
  const people = useMemo(() => rankPeopleCtx(ctx), [ctx]);
  const exposure = useExposure();
  const buzz = useMemo(() => rankBuzz(ctx, "forYou"), [ctx]);
  const drift = useMemo(() => rankDrift(ctx), [ctx]);
  const happening = useMemo(() => buildHappening(ctx), [ctx]);
  const neg = useMemo(() => negativeFeedback(ctx), [ctx]);
  const edition = useMemo(() => buildEdition(ctx, "japan-trip"), [ctx]);
  const hgraph = useMemo(() => buildHappeningGraph(ctx), [ctx]);
  const worldsNow = hgraph.nodes
    .filter((n) => n.tier === "major")
    .sort((a, b) => b.strength - a.strength);

  const rankIn = (list: { item: { id: string } }[], id: string) =>
    list.findIndex((x) => x.item.id === id) + 1;
  const baseRank = (map: Record<string, number> | undefined, id: string) =>
    map
      ? Object.entries(map)
          .sort((a, b) => b[1] - a[1])
          .findIndex(([k]) => k === id) + 1
      : 0;
  const zara = ctx.match("u_zara");
  const edgeCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of g.edges) out[e.type] = (out[e.type] ?? 0) + 1;
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }, [g]);
  const myEdges = g
    .from(ME_NODE)
    .filter(
      (e) => e.type !== "INTERESTED_IN" || !e.toId.startsWith("interest:"),
    );

  const nextStep = DEMO_STEPS.find((d) => !d.done(st));
  const runStep = () => nextStep?.run(useChimp.getState());
  const runAll = () => {
    for (const d of DEMO_STEPS)
      if (!d.done(useChimp.getState())) d.run(useChimp.getState());
  };
  const away = (min: number) =>
    useChimp.getState().advanceWorld(Date.now(), min * 60000);

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <StatusBar style="dark" />
      <ScreenHeader
        title="Graph Debug"
        subtitle="Development only · scores never shown in the app"
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* ── Demo path, scorecard and time travel use the fixture world: DEMO only ── */}
        {repo.mode() !== "demo" ? (
          <Section title="Demo tools">
            <T v="caption" color={colors.inkMuted}>
              The deterministic demo path, the Japan scorecard and “Simulate
              time away” run on the fixture world. Enter the Demo account
              (Settings → Developer) to use them. Everything below reflects this
              real account.
            </T>
          </Section>
        ) : (
          <>
            <Section title="Demo path">
              {DEMO_STEPS.map((d, i) => (
                <View key={d.id} style={styles.row}>
                  <View style={[styles.stepDot, d.done(st) && styles.stepDone]}>
                    {d.done(st) ? (
                      <Check size={10} color={colors.white} strokeWidth={3.5} />
                    ) : null}
                  </View>
                  <T
                    v="footnote"
                    weight={d.done(st) ? "500" : "600"}
                    color={d.done(st) ? colors.inkMuted : colors.ink}
                    style={{ flex: 1 }}
                  >
                    {`${i + 1}. ${d.label}`}
                  </T>
                </View>
              ))}
              <View style={styles.buttons}>
                <Btn
                  icon={<SkipForward size={14} color={colors.white} />}
                  label={nextStep ? "Next step" : "All done"}
                  onPress={runStep}
                  disabled={!nextStep}
                />
                <Btn
                  icon={<Play size={14} color={colors.white} />}
                  label="Run all"
                  onPress={runAll}
                  disabled={!nextStep}
                />
                <Btn
                  icon={<RotateCcw size={14} color={colors.accent} />}
                  label="Reset demo"
                  onPress={() => st.resetDemo()}
                  ghost
                />
              </View>
            </Section>

            {/* ── Scorecard ── */}
            <Section title="Before (session start) → now">
              <KV
                k="Japan affinity"
                v={`${fmt(baseline?.affinity.i_japan)} → ${fmt(s.affinity.i_japan)}`}
              />
              <KV
                k="Travel affinity"
                v={`${fmt(baseline?.affinity.i_travel)} → ${fmt(s.affinity.i_travel)}`}
              />
              <KV
                k="Style affinity"
                v={`${fmt(baseline?.affinity.i_style)} → ${fmt(s.affinity.i_style)}`}
              />
              <KV
                k="Japan Today order"
                v={`${baseline?.edition?.join(" › ") ?? "–"}\n→ ${editionOrder(ctx, "japan-trip").join(" › ")}`}
              />
              <KV
                k="Japan branch (Happening)"
                v={`${fmt((baseline?.happening?.h_japan ?? NaN) / 100)} → ${fmt((worldsNow.find((n) => n.id === "h_japan")?.strength ?? 0) / 100)} · rank #${worldsNow.findIndex((n) => n.id === "h_japan") + 1}`}
              />
              <KV
                k="Japan Trip rank (Boards)"
                v={`#${baseRank(baseline?.boards, "japan-trip")} → #${rankIn(boards, "japan-trip")}`}
              />
              <KV
                k="Tokyo Food Tour rank (Moves)"
                v={`#${baseRank(baseline?.moves, "mv_tokyo_food")} → #${rankIn(moves, "mv_tokyo_food")}`}
              />
              <KV
                k="Japan Trip story rank"
                v={`#${baseRank(baseline?.stories, "st_japan")} → #${rankIn(stories, "st_japan")}`}
              />
              <KV
                k="Japan Drift video (Drift)"
                v={`#${baseRank(baseline?.drift, DEMO_IDS.driftJapan)} → #${rankIn(drift, DEMO_IDS.driftJapan)}`}
              />
              <KV
                k="Kyoto post (Buzz For You)"
                v={`#${baseRank(baseline?.buzz, DEMO_IDS.buzzJapan)} → #${rankIn(buzz, DEMO_IDS.buzzJapan)}`}
              />
              <KV
                k="Street Style post (Buzz)"
                v={`#${baseRank(baseline?.buzz, "bz_same_fit")} → #${rankIn(buzz, "bz_same_fit")}`}
              />
              <KV
                k="Maya Tanaka match"
                v={`${baseline?.matches.u_maya_t ?? "–"}% → ${ctx.match("u_maya_t").matchScore}% (${ctx.match("u_maya_t").relationship})`}
              />
              <KV
                k="Zara match"
                v={`${baseline?.matches.u_zara ?? "–"}% → ${zara.matchScore}% (${zara.relationship})`}
              />
              <KV
                k="Session baseline"
                v={
                  baseline ? new Date(baseline.at).toLocaleTimeString() : "none"
                }
              />
              <View style={styles.buttons}>
                <Btn
                  label="Mark baseline now"
                  onPress={() => st.markBaseline()}
                  ghost
                />
              </View>
            </Section>

            {/* ── Off-session ── */}
            <Section title="Simulate time away">
              <T v="caption" color={colors.inkMuted}>
                {`Releases 1 (10–30 min), 2 (30–120 min) or 3 (2h+) changes: queued reactions and pool events whose conditions hold. ${st.pendingChanges.length} queued now.`}
              </T>
              <View style={styles.buttons}>
                <Btn label="20 min" onPress={() => away(20)} />
                <Btn label="1 hour" onPress={() => away(60)} />
                <Btn label="3 hours" onPress={() => away(180)} />
              </View>
            </Section>
          </>
        )}

        {/* ── Affinity ── */}
        <Section title="Top affinities">
          {Object.entries(s.affinity)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id, v]) => {
              const d = baseline ? v - (baseline.affinity[id] ?? 0) : 0;
              return (
                <View key={id} style={styles.row}>
                  <T v="footnote" weight="600" style={{ width: 92 }}>
                    {interestById[id]?.label ?? id}
                  </T>
                  <ProgressBar value={v * 100} style={{ flex: 1 }} />
                  <T v="caption" weight="700" style={styles.num}>
                    {v.toFixed(2)}
                  </T>
                  <T
                    v="caption"
                    weight="600"
                    color={
                      d > 0
                        ? colors.success
                        : d < 0
                          ? colors.danger
                          : colors.inkFaint
                    }
                    style={styles.num}
                  >
                    {d ? `${d > 0 ? "+" : ""}${d.toFixed(2)}` : ""}
                  </T>
                </View>
              );
            })}
        </Section>

        {/* ── Negative feedback ── */}
        <Section
          title={`Negative feedback · ${neg.count} dislike${neg.count === 1 ? "" : "s"}`}
        >
          {neg.count ? (
            <>
              <KV
                k="Disliked"
                v={Object.keys(s.buzzDislikes)
                  .map((id) => repo.labelFor({ kind: "buzz", id }))
                  .join(" · ")}
              />
              <KV
                k="Worlds (−6 each)"
                v={Object.entries(neg.boards)
                  .map(([id, n]) => `${repo.board(id)?.title} ×${n}`)
                  .join(", ")}
              />
              <KV
                k="Interests (−2.5 each)"
                v={Object.entries(neg.interests)
                  .map(([id, n]) => `${interestById[id]?.label ?? id} ×${n}`)
                  .join(", ")}
              />
              <KV
                k="Creators (−3 each)"
                v={Object.entries(neg.authors)
                  .map(([id, n]) => `${firstName(id)} ×${n}`)
                  .join(", ")}
              />
            </>
          ) : (
            <T v="caption" color={colors.inkFaint}>
              No dislikes yet. Dislike a Buzz item to see its effect (penalty
              capped at 16 points).
            </T>
          )}
        </Section>

        {/* ── Account + Crush diagnostic (Phase 6A) ── */}
        <Section
          title={`Account · ${repo.mode().toUpperCase()} · ${repo.me().displayName}`}
        >
          <KV k="Your Open To" v={(s.openTo ?? []).join(", ") || "–"} />
          <KV
            k="People in this dataset"
            v={`${repo.people().length}${repo.mode() === "real" ? " (real accounts only)" : " (seeded demo people)"}`}
          />
          <T v="caption" weight="700" style={{ marginTop: 8 }}>
            Crush eligibility (both open to dating/casual, not blocked, not you)
          </T>
          {repo
            .people()
            .filter(
              (p) =>
                (p.openTo ?? []).some(
                  (o) => o === "dating" || o === "casual",
                ) || s.crushes[p.id],
            )
            .slice(0, 8)
            .map((p) => {
              const e = crushEligibility(ctx, p.id);
              return (
                <T
                  key={p.id}
                  v="caption"
                  color={e.eligible ? colors.success : colors.ink2}
                >
                  {`${e.eligible ? "✓" : "✕"} ${p.displayName} · their Open To: ${e.theirs.join(", ") || "–"}${e.eligible ? "" : ` · reason: ${e.reason}`}`}
                </T>
              );
            })}
          {repo.people().length === 0 ? (
            <T v="caption" color={colors.inkFaint}>
              No other people yet (REAL mode shows only real accounts).
            </T>
          ) : null}
        </Section>

        {/* ── Relationships ── */}
        <Section title="Relationships">
          <KV
            k="Joined"
            v={
              Object.keys(s.joined)
                .map((id) => repo.board(id)?.title ?? id)
                .join(", ") || "–"
            }
          />
          <KV
            k="Saved Boards"
            v={
              Object.keys(s.savedBoards)
                .map((id) => repo.board(id)?.title ?? id)
                .join(", ") || "–"
            }
          />
          <KV
            k="Following"
            v={Object.keys(s.following).map(firstName).join(", ") || "–"}
          />
          <KV
            k="Connections"
            v={Object.keys(s.connections).map(firstName).join(", ") || "–"}
          />
          <KV
            k="Blocked"
            v={Object.keys(s.blocked).map(firstName).join(", ") || "–"}
          />
          <KV
            k="Crush (private)"
            v={
              Object.keys(s.crushes)
                .map(
                  (id) =>
                    `${firstName(id)}${ctx.match(id).spark ? " → Spark" : crushEligible(ctx, id) ? "" : " (not eligible now)"}`,
                )
                .join(", ") || "–"
            }
          />
          <KV
            k="Sparks (mutual)"
            v={
              Object.keys(s.crushes)
                .filter((id) => ctx.match(id).spark)
                .map(firstName)
                .join(", ") || "–"
            }
          />
          <KV
            k="Crush eligible"
            v={
              rankPeopleCtx(ctx)
                .filter((p) => crushEligible(ctx, p.person.id))
                .map((p) => p.person.displayName)
                .join(", ") ||
              "none (you or they are not open to dating/casual)"
            }
          />
          <KV
            k="Drift watched"
            v={Object.keys(s.driftViews).join(", ") || "–"}
          />
          <KV
            k="Worlds visited"
            v={
              Object.keys(s.boardVisits)
                .map((id) => repo.board(id)?.title ?? id)
                .join(", ") || "–"
            }
          />
          <KV
            k="Buzz likes / saves"
            v={`${Object.keys(s.buzzLikes).length} / ${Object.keys(s.buzzSaves).length}`}
          />
          <KV
            k="Drift likes / saves"
            v={`${Object.keys(s.driftLikes).length} / ${Object.keys(s.driftSaves).length}`}
          />
          <KV
            k="Move state"
            v={
              Object.entries(s.moveState)
                .map(
                  ([id, m]) =>
                    `${repo.move(id)?.title} (${Object.entries(m)
                      .filter(([, v]) => v)
                      .map(([k]) => k)
                      .join("/")})`,
                )
                .join(", ") || "–"
            }
          />
        </Section>

        {/* ── Loops ── */}
        <Section title="Open Loops">
          {s.openLoops.map((l) => {
            const p = loopProgress(ctx, l);
            return (
              <View key={l.id} style={{ marginBottom: 10 }}>
                <View style={styles.row}>
                  <T v="footnote" weight="700" style={{ flex: 1 }}>
                    {l.title}
                  </T>
                  <T
                    v="caption"
                    weight="700"
                    color={isActiveLoop(l) ? colors.accent : colors.inkFaint}
                  >{`${p.status} · ${p.progress}%`}</T>
                </View>
                <T v="caption" color={colors.inkMuted}>
                  {p.steps
                    .map(
                      (x) => `${x.done ? "✓" : "○"} ${x.label} (${x.weight})`,
                    )
                    .join("  ")}
                </T>
              </View>
            );
          })}
        </Section>

        {/* ── Changes ── */}
        <Section
          title={`Change events · ${s.changes.filter((c) => !c.seen).length} unseen`}
        >
          {s.changes.slice(0, 10).map((c) => (
            <T
              key={c.id}
              v="caption"
              color={c.seen ? colors.inkFaint : colors.ink}
              style={{ marginBottom: 4 }}
            >
              {`${c.seen ? "·" : "●"} [${c.type} i${c.importance} ${c.source}] ${c.message} — ${c.reason}`}
            </T>
          ))}
        </Section>
        <Section title={`Queued for next return · ${st.pendingChanges.length}`}>
          {st.pendingChanges.length ? (
            st.pendingChanges.map((c) => (
              <T key={c.id} v="caption" style={{ marginBottom: 4 }}>
                {`○ [${c.type} i${c.importance}] ${c.message}`}
              </T>
            ))
          ) : (
            <T v="caption" color={colors.inkFaint}>
              Nothing queued. Act in the app to create reactions.
            </T>
          )}
        </Section>

        {/* ── Recommendations ── */}
        <RecList
          title="Boards"
          list={boards.slice(0, 6)}
          base={baseline?.boards}
          label={(b) => b.title}
        />
        <RecList
          title="Moves"
          list={moves.slice(0, 6)}
          base={baseline?.moves}
          label={(m) => m.title}
        />
        <RecList
          title="Stories (trending)"
          list={stories.slice(0, 5)}
          base={baseline?.stories}
          label={(x) => x.title}
        />
        <RecList
          title="Drift"
          list={drift.slice(0, 6)}
          base={baseline?.drift}
          label={(x) => `${repo.board(x.boardId)?.title}: ${x.caption}`}
        />
        <RecList
          title="Buzz (For You)"
          list={buzz.slice(0, 6)}
          base={baseline?.buzz}
          label={(x) =>
            `${repo.board(x.boardId)?.title}: ${repo.labelFor({ kind: "buzz", id: x.id })}`
          }
        />
        {/* ── Living World: Japan Trip Today ── */}
        <Section title="Japan Trip · Today module ranking">
          {edition ? (
            <>
              <KV
                k="Lead / cover"
                v={`${edition.lead?.kind ?? "–"} · ${edition.lead ? repo.labelFor({ kind: edition.lead.kind === "news" ? "buzz" : edition.lead.kind, id: edition.lead.item.id } as never) : ""} (${edition.lead?.score.toFixed(1) ?? ""})`}
              />
              {edition.modules.map((m, i) => (
                <View key={m.id} style={styles.row}>
                  <T
                    v="footnote"
                    weight="700"
                    style={{ flex: 1 }}
                  >{`${i + 1}. ${m.title}${m.why ? `  ↑ ${m.why}` : ""}`}</T>
                  <T
                    v="caption"
                    weight="600"
                    color={colors.inkMuted}
                    style={styles.num}
                  >{`${m.base}+${m.boost}`}</T>
                  <T v="caption" weight="800" style={styles.num}>
                    {m.score.toFixed(1)}
                  </T>
                </View>
              ))}
              <KV
                k="Topics (your order)"
                v={edition.topics
                  .map((t) => `${t.topic.label} ${t.affinity.toFixed(2)}`)
                  .join(" · ")}
              />
            </>
          ) : null}
        </Section>

        {/* ── Happening graph ── */}
        <Section title={`Happening graph · focus ${hgraph.focus ?? "none"}`}>
          {worldsNow.map((n) => {
            const before = baseline?.happening?.[n.id];
            return (
              <View key={n.id} style={{ marginBottom: 6 }}>
                <View style={styles.row}>
                  <T
                    v="footnote"
                    weight="700"
                    style={{ flex: 1 }}
                  >{`${n.label} · d${n.d} · badge ${n.badge}${n.avatarOf ? ` · ${firstName(n.avatarOf)}` : ""}`}</T>
                  <T
                    v="caption"
                    weight="600"
                    color={colors.inkMuted}
                    style={styles.num}
                  >
                    {before !== undefined ? before.toFixed(1) : ""}
                  </T>
                  <T v="caption" weight="800" style={styles.num}>
                    {n.strength.toFixed(1)}
                  </T>
                </View>
                <T v="caption" color={colors.accent}>
                  {n.why.join(" · ")}
                </T>
              </View>
            );
          })}
          <T v="caption" weight="700" style={{ marginTop: 6 }}>
            {`Supporting / expanded nodes · ${hgraph.nodes.filter((n) => n.tier !== "major").length}`}
          </T>
          {hgraph.nodes
            .filter((n) => n.tier !== "major")
            .map((n) => (
              <T
                key={n.id}
                v="caption"
                color={colors.ink2}
              >{`${n.tier === "child" ? "▸" : "·"} ${n.worldId.replace("h_", "")} → ${n.label} (${n.kind}, ${n.strength.toFixed(0)})`}</T>
            ))}
          <T v="caption" weight="700" style={{ marginTop: 6 }}>
            {`Relationships · ${hgraph.edges.length} links`}
          </T>
          <T v="caption" color={colors.inkMuted}>
            {hgraph.edges
              .map(
                (e) =>
                  `${e.from.replace(/^h_/, "").replace(/\/.*:/, "›")}→${e.to.replace(/^h_/, "").replace(/\/.*:/, "›")}`,
              )
              .join("  ")}
          </T>
        </Section>

        <Section title={`Happening · ${happening.length} items`}>
          {happening.slice(0, 8).map((h) => (
            <View key={h.id} style={{ marginBottom: 8 }}>
              <View style={styles.row}>
                <T
                  v="footnote"
                  weight="700"
                  style={{ flex: 1 }}
                >{`[${h.kind}] ${h.title}`}</T>
                <T v="caption" weight="800" style={styles.num}>
                  {h.score.toFixed(1)}
                </T>
              </View>
              <T v="caption" color={colors.accent}>
                {h.why.join(" · ")}
              </T>
              {h.selection ? (
                <T v="caption" color={colors.inkMuted}>
                  {`7C ${describeSelection(h.selection)} · was ${h.selection.base.toFixed(1)}`}
                </T>
              ) : null}
            </View>
          ))}
          <T v="caption" color={colors.inkFaint}>
            After Dark is excluded from Happening, Drift, Buzz and the normal
            World Delta.
          </T>
        </Section>
        <Section title="Opportunity signals (7C)">
          <T v="caption" color={colors.inkMuted}>
            {`Weights · people ${fmtW(SIGNALS.people)}`}
          </T>
          <T v="caption" color={colors.inkMuted}>
            {`buzz ${fmtW(SIGNALS.buzz)} · happening ${fmtW(SIGNALS.happening)} · discover ${fmtW(SIGNALS.discover)}`}
          </T>
          <T v="caption" color={colors.inkMuted}>
            {`Penalties · repetition −${SIGNALS.penalties.repetition} · saturation −${SIGNALS.penalties.saturation} (intent recovers ${Math.round(SIGNALS.intentRecovery * 100)}%) · on: ${Object.entries(INTELLIGENCE).filter(([, v]) => v).map(([k]) => k).join(", ")}`}
          </T>
          <T v="caption" color={colors.inkMuted}>
            {`Exposure · ${Object.keys(exposure.seen).length} things seen · snapshot ${Object.keys(exposure.snapshot.seen).length} · momentum ${Object.entries(ctx.momentum()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") || "none"}`}
          </T>
          {buzz.slice(0, 4).map((x) => (
            <T key={x.item.id} v="caption" color={colors.ink2}>
              {`Buzz ${x.item.id} · ${(x as { opportunity?: Opportunity }).opportunity ? describe((x as { opportunity?: Opportunity }).opportunity!) : x.score.toFixed(1)}`}
            </T>
          ))}
          {exposure.selections.slice(0, 5).map((sel) => (
            <T key={`${sel.key}${sel.at}`} v="caption" color={colors.accent}>
              {`Selected ${sel.key} · ${sel.total.toFixed(1)} · ${sel.why.slice(0, 2).join(" · ")}`}
            </T>
          ))}
        </Section>
        <Section title="People (match score)">
          {people.slice(0, 8).map(({ person, match, opportunity }) => {
            const d =
              baseline?.matches[person.id] !== undefined
                ? match.matchScore - baseline.matches[person.id]
                : 0;
            return (
              <View key={person.id} style={{ marginBottom: 8 }}>
                <View style={styles.row}>
                  <T v="footnote" weight="700" style={{ flex: 1 }}>
                    {`${person.displayName} · ${RELATIONSHIP_LABEL[match.relationship] || "none"}`}
                  </T>
                  <T
                    v="caption"
                    weight="800"
                    style={styles.num}
                  >{`${match.matchScore}%`}</T>
                  <T
                    v="caption"
                    weight="600"
                    color={
                      d > 0
                        ? colors.success
                        : d < 0
                          ? colors.danger
                          : colors.inkFaint
                    }
                    style={styles.num}
                  >
                    {d ? `${d > 0 ? "+" : ""}${d}` : ""}
                  </T>
                </View>
                <T v="caption" color={colors.inkMuted}>
                  {Object.entries(match.parts)
                    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                    .join(" · ")}
                </T>
                <T v="caption" color={colors.accent}>
                  {match.matchReasons
                    .slice(0, 3)
                    .map((r) => r.label)
                    .join(" · ")}
                </T>
                {opportunity ? (
                  <T v="caption" color={colors.inkMuted}>
                    {`7C ${describe(opportunity)}`}
                  </T>
                ) : null}
              </View>
            );
          })}
          <T
            v="caption"
            color={colors.inkFaint}
          >{`Strong match ≥ ${MATCH.strongAt}% · NEW_MATCH event at ${MATCH.newMatchAt}%`}</T>
        </Section>

        {/* ── Graph ── */}
        <Section title={`Graph · ${g.edges.length} edges`}>
          <T v="caption" color={colors.inkMuted}>
            {edgeCounts.map(([k, v]) => `${k} ${v}`).join(" · ")}
          </T>
          <T v="caption" weight="700" style={{ marginTop: 8 }}>
            Your edges
          </T>
          {myEdges.slice(0, 24).map((e) => (
            <T key={e.id} v="caption" color={colors.ink2}>
              {`${e.type} → ${e.toId}  w${e.weight.toFixed(2)}${e.createdAt ? "  " + new Date(e.createdAt).toLocaleTimeString() : ""}`}
            </T>
          ))}
        </Section>

        <Section title="Recent activity">
          {s.activity.slice(0, 12).map((a) => (
            <T key={a.id} v="caption" color={colors.ink2}>
              {`${new Date(a.at).toLocaleTimeString()}  ${describeActivity(a) ?? a.type}${
                a.affinity
                  ? "  " +
                    Object.entries(a.affinity)
                      .map(
                        ([k, v]) =>
                          `${interestById[k]?.label ?? k}${v > 0 ? "+" : ""}${v}`,
                      )
                      .join(" ")
                  : ""
              }`}
            </T>
          ))}
        </Section>

        <Section title="Board model fixtures (not in the app)">
          {EXAMPLE_BOARDS.map((b) => (
            <T key={b.id} v="caption" color={colors.ink2}>
              {`${b.title} · ${b.type} · /${b.slug} · ${b.visibility} · theme ${b.themeId} (${b.theme.accentStyle})${b.canonicalParentId ? ` · parent ${b.canonicalParentId}` : ""}${b.location ? ` · ${b.location}` : ""}`}
            </T>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const fmt = (v: number | undefined) => (v === undefined ? "–" : v.toFixed(2));
const firstName = (id: string) =>
  repo.user(id)?.displayName.split(" ")[0] ?? id;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <T v="eyebrow" color={colors.inkMuted} style={{ marginBottom: 8 }}>
        {title.toUpperCase()}
      </T>
      {children}
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={[styles.row, { alignItems: "flex-start" }]}>
      <T v="footnote" color={colors.inkMuted} style={{ width: 150 }}>
        {k}
      </T>
      <T v="footnote" weight="600" style={{ flex: 1 }}>
        {v}
      </T>
    </View>
  );
}

function Btn({
  label,
  onPress,
  icon,
  ghost,
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  ghost?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      style={[
        styles.btn,
        ghost && styles.btnGhost,
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon}
      <T
        v="caption"
        weight="700"
        color={ghost ? colors.accent : colors.white}
        style={{ marginLeft: icon ? 5 : 0 }}
      >
        {label}
      </T>
    </Tap>
  );
}

function RecList<T extends { id: string }>({
  title,
  list,
  base,
  label,
}: {
  title: string;
  list: Scored<T>[];
  base?: Record<string, number>;
  label: (x: T) => string;
}) {
  return (
    <Section title={title}>
      {list.map((x, i) => {
        const d =
          base?.[x.item.id] !== undefined ? x.score - base[x.item.id] : 0;
        return (
          <View key={x.item.id} style={{ marginBottom: 8 }}>
            <View style={styles.row}>
              <T
                v="footnote"
                weight="700"
                style={{ flex: 1 }}
              >{`${i + 1}. ${label(x.item)}`}</T>
              <T v="caption" weight="800" style={styles.num}>
                {x.score.toFixed(1)}
              </T>
              <T
                v="caption"
                weight="600"
                color={
                  d > 0.05
                    ? colors.success
                    : d < -0.05
                      ? colors.danger
                      : colors.inkFaint
                }
                style={styles.num}
              >
                {Math.abs(d) > 0.05 ? `${d > 0 ? "+" : ""}${d.toFixed(1)}` : ""}
              </T>
            </View>
            <T v="caption" color={colors.inkMuted}>
              {Object.entries(x.parts)
                .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                .join(" · ")}
            </T>
            <T v="caption" color={colors.accent}>
              {x.reasons
                .slice(0, 4)
                .map((r) => r.text)
                .join(" · ")}
            </T>
          </View>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  num: { minWidth: 40, textAlign: "right" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.accent,
  },
  btnGhost: { backgroundColor: colors.accentSoft },
  stepDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDone: { backgroundColor: colors.accent, borderColor: colors.accent },
});

const fmtW = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k.slice(0, 4)} ${v}`)
    .join(" ");

function describeSelection(sel: NonNullable<HappeningItem["selection"]>): string {
  return `${sel.total.toFixed(1)} = ${Object.entries(sel.signals)
    .map(([k, v]) => `${k.slice(0, 4)} ${v.toFixed(2)}`)
    .join(" · ")}${sel.penalties.saturation || sel.penalties.repetition ? ` − rep ${sel.penalties.repetition.toFixed(2)} sat ${sel.penalties.saturation.toFixed(2)}` : ""}`;
}
