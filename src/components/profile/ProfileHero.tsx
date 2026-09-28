import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, MapPin, Pencil } from 'lucide-react-native';
import { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors, fonts, radius, shadow } from '@/theme';
import type { ImageSrc, ProfileMoment } from '@/types/models';
import { hrefFor } from '@/utils/links';

interface Props {
  name: string;
  verified?: boolean;
  city: string;
  image?: ImageSrc;
  /** Cut-out illustration (transparent PNG) vs. a regular photo. */
  cutout?: boolean;
  /**
   * Phase 6A: how a normal photo is shown.
   *   'framed' — any uploaded photo (selfie, busy room, landscape, low
   *              contrast…): a large rounded portrait card on the lavender
   *              world, a soft blurred extension behind it, and a white fade
   *              under the name, so text never sits on the photo.
   *   'bleed'  — the original full-bleed treatment (seeded demo people).
   */
  photoMode?: 'framed' | 'bleed';
  /** Vertical focal point of the photo (0 = top, 1 = bottom). */
  focusY?: number;
  moments?: ProfileMoment[];
  handwriting?: string;
  onEdit?: () => void;
  /** Top-right slot in view mode (e.g. a match ring). */
  badge?: ReactNode;
  children?: ReactNode;
}

const HERO_H = 440;
/** Framed mode: the photo card's share of the hero width. */
const FRAME = 0.54;

/**
 * Fit a phrase (≤40 chars + emoji) into the narrow column beside a framed
 * photo: the largest handwriting size that wraps to ≤3 lines.
 */
function fitHand(text: string, width: number): { fontSize: number; text: string; lines: number } {
  const words = text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  for (const fontSize of [27, 24, 21, 19, 17]) {
    const max = Math.max(5, Math.floor(width / (fontSize * 0.5)));
    const lines: string[] = [];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && `${cur} ${w}`.length <= max) lines[lines.length - 1] = `${cur} ${w}`;
      else lines.push(w);
    }
    if (lines.length <= 3 || fontSize === 17) return { fontSize, text: lines.join('\n'), lines: lines.length };
  }
  return { fontSize: 17, text, lines: 3 };
}

/**
 * Editorial profile hero. The person is the subject: a large portrait set
 * off-centre over a soft atmosphere, with small tilted "moments" as identity
 * signals (not a photo grid). Used for WollyMc (self) and people (view).
 */
export function ProfileHero({ name, verified, city, image, cutout, photoMode = 'bleed', focusY = 0.3, moments = [], handwriting, onEdit, badge, children }: Props) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(width, 500) - 24;
  const framed = photoMode === 'framed' && !cutout;
  const handFit = framed && handwriting ? fitHand(handwriting, cardW - cardW * FRAME - 16 - 18 - 10) : null;
  // Moments sit under the phrase; a long phrase shows two instead of three.
  const momentsTop = handFit ? Math.max(104, 16 + handFit.lines * (handFit.fontSize + 1) + 16) : 104;
  const shown = moments.slice(0, momentsTop > 120 ? 2 : 3);
  const more = moments.length - shown.length;

  return (
    <View style={[styles.card, { width: cardW }]}>
      <View style={{ height: HERO_H }}>
        {cutout ? (
          <>
            <LinearGradient colors={['#D6E4FF', '#ECE6FF', '#FFEFE6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {/* Sun / halo behind the portrait */}
            <LinearGradient
              colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']}
              style={[styles.halo, { width: cardW * 0.9, height: cardW * 0.9, borderRadius: cardW, right: -cardW * 0.18, top: 34 }]}
            />
            <Img
              uri={image}
              tint="transparent"
              contentFit="contain"
              contentPosition="bottom"
              accessibilityLabel={`${name}’s portrait`}
              style={{ position: 'absolute', right: -cardW * 0.1, bottom: 54, width: cardW * 0.86, height: cardW * 0.86 }}
            />
          </>
        ) : photoMode === 'framed' ? (
          <>
            <LinearGradient colors={['#D6E4FF', '#ECE6FF', '#FFEFE6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {image ? (
              <>
                {/* Background extension: the same photo, heavily blurred and tinted lavender. */}
                <Img uri={image} blurRadius={40} contentPosition={{ top: `${Math.round(focusY * 100)}%` }} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} />
                <LinearGradient colors={['rgba(236,230,255,0.55)', 'rgba(236,230,255,0.25)']} style={StyleSheet.absoluteFill} />
                <View style={[styles.framed, shadow.md, { width: cardW * FRAME, height: cardW * FRAME * 1.28, right: 16, top: 70 }]}>
                  <Img uri={image} contentPosition={{ top: `${Math.round(focusY * 100)}%` }} style={StyleSheet.absoluteFill} accessibilityLabel={`${name}’s photo`} />
                </View>
              </>
            ) : (
              <View style={[styles.framed, styles.noPhoto, { width: cardW * FRAME, height: cardW * FRAME * 1.28, right: 16, top: 70 }]}>
                <T style={{ fontSize: 64, fontWeight: '900', color: '#B9AEE6' }}>{name.slice(0, 1).toUpperCase()}</T>
              </View>
            )}
          </>
        ) : (
          <Img uri={image} contentPosition="top" style={StyleSheet.absoluteFill} accessibilityLabel={`${name}’s photo`} />
        )}

        {/* Fade into the card body */}
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', colors.white]} locations={[0.55, 0.84, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />

        {handwriting ? (
          <T
            style={[
              styles.hand,
              handFit
                ? { color: colors.accent, right: cardW * FRAME + 24, fontSize: handFit.fontSize, lineHeight: handFit.fontSize + 1 }
                : cutout
                  ? { color: colors.accent }
                  : styles.handOnPhoto,
            ]}
            pointerEvents="none"
          >
            {handFit ? handFit.text : handwriting}
          </T>
        ) : null}

        {onEdit ? (
          <Tap onPress={onEdit} style={styles.edit} accessibilityLabel="Edit profile">
            <Pencil size={14} color={colors.ink} />
            <T v="footnote" weight="600" style={{ marginLeft: 6 }}>
              Edit
            </T>
          </Tap>
        ) : null}
        {badge ? <View style={styles.badge}>{badge}</View> : null}

        {/* Moments: layered identity signals */}
        {shown.length ? (
          <View style={[styles.moments, cutout || framed ? { left: 14 } : { right: 14 }, { top: momentsTop }]}>
            {shown.map((m, i) => (
              <Tap
                key={m.id}
                onPress={m.ref ? () => router.push(hrefFor(m.ref!)) : undefined}
                disabled={!m.ref}
                scaleTo={0.95}
                accessibilityLabel={m.label}
                style={[
                  styles.moment,
                  {
                    top: i * 78,
                    left: cutout || photoMode === 'framed' ? (i % 2) * 26 : undefined,
                    right: cutout || photoMode === 'framed' ? undefined : (i % 2) * 26,
                    transform: [{ rotate: `${[-6, 5, -3][i]}deg` }],
                    zIndex: 3 - i,
                  },
                ]}
              >
                <Img uri={m.image} style={StyleSheet.absoluteFill} />
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} />
                <T v="caption" color={colors.white} weight="700" style={styles.momentLabel} numberOfLines={1}>
                  {m.label}
                </T>
              </Tap>
            ))}
            {more > 0 ? (
              <View style={[styles.more, cutout || photoMode === 'framed' ? { left: 58 } : { right: 58 }]}>
                <T v="footnote" color={colors.white} weight="800">{`+${more}`}</T>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.nameBlock} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 40, lineHeight: 46, flexShrink: 1 }}>
              {name}
            </T>
            {verified ? <BadgeCheck size={28} color={colors.white} fill={colors.accent} style={{ marginLeft: 8 }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <MapPin size={16} color={colors.ink2} />
            <T v="callout" color={colors.ink2} style={{ marginLeft: 5 }}>
              {city}
            </T>
          </View>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', borderRadius: radius.xxl, backgroundColor: colors.white, overflow: 'hidden', ...shadow.md },
  halo: { position: 'absolute' },
  hand: {
    position: 'absolute',
    left: 18,
    top: 16,
    fontFamily: fonts.hand,
    fontSize: 27,
    lineHeight: 28,
    transform: [{ rotate: '-7deg' }],
  },
  handOnPhoto: {
    color: colors.white,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  edit: {
    position: 'absolute',
    right: 14,
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  badge: { position: 'absolute', right: 14, top: 14 },
  moments: { position: 'absolute', top: 104, width: 112, height: 250 },
  framed: { position: 'absolute', borderRadius: 30, overflow: 'hidden', borderWidth: 4, borderColor: colors.white, backgroundColor: '#EDE8FF', transform: [{ rotate: '2deg' }] },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  moment: {
    position: 'absolute',
    width: 80,
    height: 96,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.bgSoft,
    ...shadow.md,
  },
  momentLabel: { position: 'absolute', left: 7, right: 5, bottom: 5, fontSize: 11 },
  more: {
    position: 'absolute',
    top: 214,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,24,34,0.6)',
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  nameBlock: { position: 'absolute', left: 18, right: 18, bottom: 10 },
  body: { paddingHorizontal: 18, paddingBottom: 18, paddingTop: 6 },
});
