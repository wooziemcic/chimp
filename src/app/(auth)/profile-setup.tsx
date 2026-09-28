import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { AuthScreen, ErrorNote, Headline, PrimaryButton, Steps, TextLink } from '@/components/auth/AuthUI';
import { AvatarPicker, Field } from '@/components/auth/Onboarding';
import { USERNAME_RE, usernameAvailable } from '@/services/backend/content';
import { auth } from '@/components/auth/palette';
import { type PickedImage, type UploadedMedia, pickImages, setProfilePhoto } from '@/services/backend/media';
import { useSession } from '@/store/useSession';

/** Step 1: who you are. Photo, name, @username, city, bio. Nothing more. */
export default function ProfileSetup() {
  const uid = useSession((s) => s.uid);
  const profile = useSession((s) => s.profile);
  const saveProfile = useSession((s) => s.saveProfile);
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [focusY, setFocusY] = useState(profile?.avatar_focus_y ?? 0.3);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  // The availability answer, tagged with the handle it was for. A stale answer
  // (for a handle you've since edited) reads as "not checked yet".
  const [check, setCheck] = useState<{ handle: string; taken: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 6D: the photo step failed after the profile was saved (retry, or go on without it).
  const [photoFailed, setPhotoFailed] = useState(false);
  // A photo that already uploaded in an earlier attempt: reused on retry (no second copy).
  const uploaded = useRef<{ uri: string; media: UploadedMedia } | null>(null);

  const handle = username.trim().toLowerCase();
  const validHandle = USERNAME_RE.test(handle);
  useEffect(() => {
    if (!uid || !validHandle) return;
    let live = true;
    const t = setTimeout(() => {
      usernameAvailable(handle, uid)
        .then((ok) => live && setCheck({ handle, taken: !ok }))
        .catch(() => live && setCheck(null));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [handle, validHandle, uid]);
  const taken = validHandle && check?.handle === handle ? check.taken : null;

  if (!uid) return <Redirect href="/welcome" />;

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const [img] = await pickImages({ source, square: true });
      if (img) {
        setPhoto(img);
        setPhotoFailed(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ready = name.trim().length > 0 && validHandle && taken !== true && bio.length <= 280;
  /**
   * Phase 6D order (media rows belong to a profile: media.owner_id → profiles.id):
   *   1. save the profile row (an upsert on your own id: repeating it is harmless)
   *   2. upload the photo, 3. point the profile at it, 4. remove any older photo
   * A retry repeats 1 and reuses a photo that already uploaded.
   */
  const next = async (withPhoto = true) => {
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      const row = await saveProfile({ display_name: name.trim(), username: handle, city: city.trim(), bio: bio.trim(), avatar_focus_y: focusY });
      saved = true;
      if (photo && withPhoto) {
        await setProfilePhoto({
          userId: uid,
          photo,
          previousMediaId: row.avatar_media_id,
          reuse: uploaded.current?.uri === photo.uri ? uploaded.current.media : null,
          onUploaded: (media) => {
            uploaded.current = { uri: photo.uri, media };
          },
          link: (patch) => saveProfile(patch),
        });
      }
      router.replace('/phrase');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (saved) {
        setPhotoFailed(true);
        setError(`Your profile is saved, but the photo didn’t upload (${msg}). Tap Continue to try again, or continue without it.`);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen back={false} footer={<PrimaryButton label="Continue" onPress={() => void next()} disabled={!ready} loading={busy} />}>
      <StatusBar style="light" />
      <View style={{ height: 24 }} />
      <Steps at={0} />
      <Headline title="Make it yours" sub="A photo, a name and a few words. You can change any of it later." />
      <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
        <AvatarPicker uri={photo?.uri ?? profile?.avatar_url ?? undefined} focusY={focusY} onCamera={() => pick('camera')} onLibrary={() => pick('library')} onFocus={setFocusY} />
        <Field label="Display name" value={name} onChangeText={setName} placeholder="What friends call you" maxLength={50} autoCapitalize="words" />
        <Field
          label="Username"
          prefix="@"
          value={username}
          onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
          placeholder="yourname"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          hint={!handle ? '3–24 letters, numbers, dots or underscores.' : !validHandle ? 'Use 3–24 letters, numbers, dots or underscores.' : taken ? 'That one’s taken.' : taken === false ? 'Available ✓' : null}
        />
        <Field label="City" value={city} onChangeText={setCity} placeholder="Where you are" maxLength={60} autoCapitalize="words" />
        <Field label="Bio" value={bio} onChangeText={setBio} placeholder="What you’re into, what you’re up to" multiline max={280} count={bio.length} />
        <ErrorNote text={error} />
        {photoFailed && !busy ? <TextLink label="Continue without the photo" onPress={() => void next(false)} color={auth.salmon} /> : null}
        <View style={{ height: 24 }} />
      </View>
    </AuthScreen>
  );
}
