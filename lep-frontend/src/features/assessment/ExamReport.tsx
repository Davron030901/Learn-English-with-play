import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useExamReport, type ExamReportOut } from '@/api/queries/assessment';
import {
  Button,
  Card,
  Icon,
  Notice,
  ProgressBar,
  Screen,
  ScreenHeader,
  SectionTitle,
  Txt,
} from '@/design';
import { asProblem, ProblemNotice } from '@/features/errors';

const pct = (x: number) => Math.round(x * 100);

const PAPER_ORDER = ['listening', 'reading', 'use_of_english'] as const;

/**
 * The full report after a level exam (docs/12 §9.2; backend DECISIONS §14.7), shown honestly
 * (§9.3): the note that it is an internal assessment first; every paper with its bars and a band
 * word, never one bare score; a skill that has not been assessed says so — never zero; error
 * types are the learner's own counts, with the plain fact that no level norms exist yet; the
 * vocabulary figure is labelled an estimate; the speech rate waits for recorded speech to be
 * scored; the timeline is units left at the learner's own pace, or says there is no pace yet.
 */
export function ExamReport({ examId, onBack }: { examId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const report = useExamReport(examId);
  const header = (
    <ScreenHeader title={t('examReport.title')} onBack={onBack} backLabel={t('common.back')} />
  );

  if (report.error) {
    return (
      <Screen header={header} testID="exam-report-error">
        <ProblemNotice problem={asProblem(report.error)} onRetry={() => void report.refetch()} />
      </Screen>
    );
  }
  if (!report.data) {
    return (
      <Screen header={header}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return <ReportBody report={report.data} header={header} onBack={onBack} />;
}

function ReportBody({
  report: r,
  header,
  onBack,
}: {
  report: ExamReportOut;
  header: React.ReactNode;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const papers = [...r.papers].sort((a, b) => order(a.paper) - order(b.paper));
  return (
    <Screen header={header} testID="exam-report">
      <Notice icon="info">{t('examReport.note')}</Notice>

      <Card>
        <SectionTitle>{t('examReport.papers')}</SectionTitle>
        <Txt variant="body-s" color="ink-2" testID="exam-report-overall">
          {t('examReport.overall', { value: pct(r.overall), level: r.level })}
        </Txt>
        {papers.map((p) => (
          <View key={p.paper} style={{ gap: 4 }} testID={`exam-report-paper-${p.paper}`}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Txt variant="body-m" weight={800} style={{ flex: 1 }}>
                {t(`exam.paper.${p.paper}`, { defaultValue: p.paper })}
              </Txt>
              <Txt variant="body-m">{`${pct(p.score)}%`}</Txt>
            </View>
            <ProgressBar
              value={p.score}
              tone={p.band === 'below' ? 'orange' : 'green'}
              size="sm"
              label={t('examReport.paperA11y', {
                paper: t(`exam.paper.${p.paper}`, { defaultValue: p.paper }),
                value: pct(p.score),
              })}
            />
            <Txt variant="body-s" color="ink-2">
              {t(`examReport.band.${p.band}`)}
            </Txt>
            <Txt variant="body-s" color="ink-3">
              {t('examReport.paperDetail', {
                answered: p.answered,
                asked: p.asked,
                paperBar: pct(p.paper_bar),
                overallBar: pct(p.overall_bar),
              })}
              {p.median_seconds !== null
                ? ` ${t('examReport.paperPace', { seconds: Math.round(p.median_seconds) })}`
                : ''}
            </Txt>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>{t('examReport.skills')}</SectionTitle>
        {r.skills.map((s) => (
          <View key={s.skill} style={{ gap: 4 }} testID={`exam-report-skill-${s.skill}`}>
            <Txt variant="body-m" weight={800}>
              {t(`examReport.skill.${s.skill}`)}
            </Txt>
            {s.value === null ? (
              <Txt variant="body-s" color="ink-3" testID={`exam-report-skill-${s.skill}-none`}>
                {t('examReport.notAssessed')}
              </Txt>
            ) : (
              <>
                <ProgressBar
                  value={s.value}
                  max={s.scale === 'band' ? 6 : 1}
                  size="sm"
                  tone={s.value >= s.target ? 'green' : 'orange'}
                  label={skillText(t, s)}
                />
                <Txt variant="body-s" color="ink-2">
                  {skillText(t, s)}
                </Txt>
              </>
            )}
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>{t('examReport.errors')}</SectionTitle>
        {r.error_types.length === 0 ? (
          <Txt variant="body-s" color="ink-2">
            {t('examReport.noErrors')}
          </Txt>
        ) : (
          r.error_types.map((e) => (
            <Txt key={e.kind} variant="body-m" testID={`exam-report-errors-${e.kind}`}>
              {t('examReport.errorLine', {
                kind: t(`examReport.kind.${e.kind}`),
                wrong: e.wrong,
                asked: e.asked,
              })}
            </Txt>
          ))
        )}
        <Txt variant="body-s" color="ink-3">
          {t('examReport.noNorms')}
        </Txt>
      </Card>

      {r.work_on.length ? (
        <Card>
          <SectionTitle>{t('examReport.workOn')}</SectionTitle>
          {r.work_on.map((w) => (
            <Pressable
              key={w.target}
              accessibilityRole={w.unit_id ? 'link' : undefined}
              disabled={!w.unit_id}
              onPress={() => (w.unit_id ? router.push(`/unit/${w.unit_id}`) : undefined)}
              style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 }}
              testID={`exam-report-work-${w.target}`}
            >
              <Icon name="target" size={20} />
              <View style={{ flex: 1 }}>
                <Txt variant="body-m" weight={700}>
                  {w.label ?? w.target}
                </Txt>
                <Txt variant="body-s" color="ink-2">
                  {t('examReport.workLine', {
                    kind: t(`examReport.kind.${w.kind}`),
                    wrong: w.wrong,
                    asked: w.asked,
                  })}
                </Txt>
              </View>
              {w.unit_id ? <Icon name="chevron-right" size={18} /> : null}
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('examReport.vocabulary')}</SectionTitle>
        <Txt variant="body-m">
          {t('examReport.vocabularyLine', {
            known: r.vocabulary.known_lexemes,
            levelKnown: r.vocabulary.level_known,
            levelTotal: r.vocabulary.level_total,
            level: r.level,
          })}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {t('examReport.coverageEstimate', { percent: Math.round(r.vocabulary.estimate_percent) })}
        </Txt>
      </Card>

      <Card>
        <SectionTitle>{t('examReport.fluency')}</SectionTitle>
        <Txt variant="body-s">
          {t('examReport.readingTarget', { wpm: r.fluency.reading_target_wpm })}
        </Txt>
        <Txt variant="body-s">
          {t('examReport.speechTarget', { wpm: r.fluency.speech_target_wpm })}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {r.fluency.speech_rate_wpm === null
            ? t('examReport.speechRateLater')
            : t('examReport.speechRate', { wpm: Math.round(r.fluency.speech_rate_wpm) })}
        </Txt>
      </Card>

      <Card>
        <SectionTitle>{t('examReport.timeline')}</SectionTitle>
        <Txt variant="body-m" testID="exam-report-timeline">
          {timelineText(t, r)}
        </Txt>
      </Card>

      <Button block onPress={onBack} testID="exam-report-done">
        {t('common.done')}
      </Button>
    </Screen>
  );
}

function order(paper: string): number {
  const i = (PAPER_ORDER as readonly string[]).indexOf(paper);
  return i < 0 ? PAPER_ORDER.length : i;
}

type T = ReturnType<typeof useTranslation>['t'];

function skillText(t: T, s: ExamReportOut['skills'][number]): string {
  if (s.value === null) return t('examReport.notAssessed');
  return s.scale === 'band'
    ? t('examReport.bandValue', { value: s.value, target: s.target })
    : t('examReport.shareValue', { value: pct(s.value), target: pct(s.target) });
}

export function timelineText(t: T, r: ExamReportOut): string {
  const tl = r.timeline;
  if (tl.reason === 'top_level' || tl.next_level === null) return t('examReport.timelineTop');
  if (tl.units_left === 0) return t('examReport.timelineDone', { next: tl.next_level });
  if (tl.weeks === null || tl.units_per_week === null)
    return t('examReport.timelineNoPace', { units: tl.units_left, next: tl.next_level });
  return t('examReport.timelineWeeks', {
    weeks: tl.weeks,
    next: tl.next_level,
    pace: tl.units_per_week,
    units: tl.units_left,
  });
}
