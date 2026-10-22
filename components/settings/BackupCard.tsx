import React, { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { formatDistanceToNowStrict } from 'date-fns';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import {
  autoBackupAvailable,
  autoBackupOn,
  noteManualBackup,
  runAutoBackup,
  sealWithImages,
  turnOffAutoBackup,
  turnOnAutoBackup,
  useBackupState,
} from '@/lib/auto-backup';
import { BackupError, MIN_PASSPHRASE, backupFileName, openBackup, type BackupPayload } from '@/lib/backup';
import { noFocusRing } from '@/utils/web';

type Step =
  | { kind: 'idle' }
  | { kind: 'export' }
  | { kind: 'import'; fileText: string; fileName: string }
  | { kind: 'confirm-import'; payload: BackupPayload }
  | { kind: 'working'; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

/** Saves the backup: the share sheet on a phone (Drive, Files, email…), a download on web. */
async function deliver(fileName: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save your Mnemo backup',
    UTI: 'public.data',
  });
}

async function readPicked(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    const webFile = (asset as { file?: Blob }).file;
    return webFile ? await webFile.text() : await (await fetch(asset.uri)).text();
  }
  return new File(asset.uri).text();
}

function PassphraseField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const colors = useThemeColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.fgTertiary}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={label}
      className="font-sans text-body rounded-md px-4 h-12"
      style={[{ color: colors.fg, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }, noFocusRing]}
    />
  );
}

/**
 * Settings → Backup. Export seals every thread into one `.mnemo` file with a
 * passphrase; import opens one and merges it in, never deleting anything.
 */
export function BackupCard() {
  const colors = useThemeColors();
  const { exportBackup, importBackup } = useMnemoStore();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passError, setPassError] = useState('');

  const reset = () => {
    setPass('');
    setConfirm('');
    setPassError('');
    setStep({ kind: 'idle' });
  };

  const fail = (message: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setStep({ kind: 'error', message });
  };

  const runExport = async () => {
    const payload = exportBackup();
    setStep({ kind: 'working', label: 'Encrypting…' });
    try {
      const text = await sealWithImages(payload, pass);
      await deliver(backupFileName(), text);
      noteManualBackup();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPass('');
      setConfirm('');
      setStep({
        kind: 'done',
        message: `Backup made: ${payload.items.length} threads, ${payload.entries.length} entries. Keep the passphrase safe; Mnemo can't recover it.`,
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : 'The backup could not be made.');
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setStep({ kind: 'import', fileText: await readPicked(asset), fileName: asset.name });
    } catch {
      fail('That file could not be read.');
    }
  };

  const runOpen = async (fileText: string) => {
    setStep({ kind: 'working', label: 'Opening…' });
    try {
      const payload = await openBackup(fileText, pass);
      setPass('');
      setStep({ kind: 'confirm-import', payload });
    } catch (e) {
      if (e instanceof BackupError && e.reason === 'wrong-passphrase') {
        // Let them try the passphrase again without picking the file again.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setStep({ kind: 'import', fileText, fileName: '' });
        setPassError(e.message);
        return;
      }
      fail(e instanceof Error ? e.message : 'The backup could not be opened.');
    }
  };

  const runImport = async (payload: BackupPayload) => {
    setStep({ kind: 'working', label: 'Importing…' });
    try {
      const r = await importBackup(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const parts = [
        r.added ? `${r.added} new ${r.added === 1 ? 'thread' : 'threads'}` : '',
        r.updated ? `${r.updated} updated` : '',
        r.unchanged ? `${r.unchanged} already here` : '',
      ].filter(Boolean);
      setStep({ kind: 'done', message: `Imported: ${parts.join(', ') || 'nothing new'}. Nothing on this phone was deleted.` });
    } catch {
      fail('The notes could not be saved. Nothing was changed.');
    }
  };

  const input = (value: string, onChange: (v: string) => void, placeholder: string, label: string) => (
    <PassphraseField value={value} onChange={onChange} placeholder={placeholder} label={label} />
  );

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50">
      <View className="flex-row items-center mb-2">
        <Icon name="archive" size={15} color={colors.accent} />
        <Text className="font-sans-semi text-sm text-fg ml-2">Encrypted backup</Text>
      </View>
      <Text className="font-sans text-sm text-fg-secondary leading-relaxed mb-4">
        Save all your notes in one file, locked with a passphrase. Keep it in Drive, email it to
        yourself, or move it to a new phone and import it there.
      </Text>

      {step.kind === 'idle' && (
        <View className="flex-row gap-2">
          <Button variant="primary" size="sm" icon="arrowUpRight" className="flex-1" onPress={() => setStep({ kind: 'export' })}>
            Export
          </Button>
          <Button variant="quiet" size="sm" icon="plus" className="flex-1" onPress={pickFile}>
            Import
          </Button>
        </View>
      )}

      {step.kind === 'export' && (
        <View className="gap-2.5">
          {input(pass, setPass, `Passphrase (at least ${MIN_PASSPHRASE} characters)`, 'Passphrase')}
          {input(confirm, setConfirm, 'Type it again', 'Confirm passphrase')}
          <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
            You'll need this passphrase to open the file. If you forget it, the backup can't be opened by
            anyone, including us.
          </Text>
          <View className="flex-row gap-2 mt-1">
            <Button variant="ghost" size="sm" onPress={reset}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="check"
              className="flex-1"
              disabled={pass.length < MIN_PASSPHRASE || pass !== confirm}
              onPress={runExport}
            >
              {pass && confirm && pass !== confirm ? "Passphrases don't match" : 'Create backup'}
            </Button>
          </View>
        </View>
      )}

      {step.kind === 'import' && (
        <View className="gap-2.5">
          {step.fileName ? (
            <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={1}>
              {step.fileName}
            </Text>
          ) : null}
          {input(pass, setPass, 'Backup passphrase', 'Backup passphrase')}
          {passError ? (
            <Text className="font-sans text-sm" style={{ color: colors.error }}>
              {passError}
            </Text>
          ) : null}
          <View className="flex-row gap-2 mt-1">
            <Button variant="ghost" size="sm" onPress={reset}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={!pass}
              onPress={() => {
                setPassError('');
                runOpen(step.fileText);
              }}
            >
              Open backup
            </Button>
          </View>
        </View>
      )}

      {step.kind === 'confirm-import' && (
        <View className="gap-2.5">
          <Text className="font-sans text-body" style={{ color: colors.fg }}>
            {step.payload.items.length} threads and {step.payload.entries.length} entries, saved{' '}
            {new Date(step.payload.exportedAt).toLocaleDateString()}.
          </Text>
          <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
            They'll be added to what's here. Where both have the same thread, the newer copy is kept.
          </Text>
          <View className="flex-row gap-2 mt-1">
            <Button variant="ghost" size="sm" onPress={reset}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" icon="check" className="flex-1" onPress={() => runImport(step.payload)}>
              Import
            </Button>
          </View>
        </View>
      )}

      {step.kind === 'working' && (
        <View className="flex-row items-center py-2">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text className="font-sans-medium text-sm ml-3" style={{ color: colors.fgSecondary }}>
            {step.label}
          </Text>
        </View>
      )}

      {(step.kind === 'done' || step.kind === 'error') && (
        <View className="gap-3">
          <View className="flex-row items-start">
            <Icon
              name={step.kind === 'done' ? 'check' : 'x'}
              size={16}
              color={step.kind === 'done' ? colors.accent : colors.error}
              stroke={2.4}
            />
            <Text className="flex-1 font-sans text-sm ml-2" style={{ color: step.kind === 'done' ? colors.fg : colors.error }}>
              {step.message}
            </Text>
          </View>
          <Button variant="quiet" size="sm" onPress={reset}>
            Done
          </Button>
        </View>
      )}
    </View>
  );
}

type AutoStep = { kind: 'idle' } | { kind: 'setup' } | { kind: 'working'; label: string };

/**
 * Settings → Backup, on Android: a sealed backup written once a day into a
 * folder the person picks (lib/auto-backup.ts), with how it's going.
 */
export function AutoBackupCard() {
  const colors = useThemeColors();
  const { exportBackup } = useMnemoStore();
  const backup = useBackupState();
  const [step, setStep] = useState<AutoStep>({ kind: 'idle' });
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupError, setSetupError] = useState('');
  const on = autoBackupOn(backup);

  if (!autoBackupAvailable) return null;

  const backUpNow = async (label: string) => {
    setStep({ kind: 'working', label });
    const result = await runAutoBackup(exportBackup(), { force: true });
    Haptics.notificationAsync(
      result === 'failed' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success,
    );
    setStep({ kind: 'idle' });
  };

  const chooseFolder = async () => {
    setSetupError('');
    let picked: boolean;
    try {
      picked = await turnOnAutoBackup(pass);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSetupError("The passphrase couldn't be kept on this phone, so automatic backups are still off.");
      return;
    }
    if (!picked) return;
    setPass('');
    setConfirm('');
    await backUpNow('Saving the first backup…');
  };

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50">
      <View className="flex-row items-center mb-2">
        <Icon name="repeat" size={15} color={colors.accent} />
        <Text className="font-sans-semi text-sm text-fg ml-2">Automatic backup</Text>
      </View>

      {!on && step.kind === 'idle' && (
        <>
          <Text className="font-sans text-sm text-fg-secondary leading-relaxed mb-4">
            Once a day, when something changed, Mnemo saves a locked backup into a folder you choose. It
            keeps the last week, and one from each month before that.
          </Text>
          <Button variant="primary" size="sm" icon="check" onPress={() => setStep({ kind: 'setup' })}>
            Turn on
          </Button>
        </>
      )}

      {step.kind === 'setup' && (
        <View className="gap-2.5">
          <PassphraseField value={pass} onChange={setPass} placeholder={`Passphrase (at least ${MIN_PASSPHRASE} characters)`} label="Passphrase" />
          <PassphraseField value={confirm} onChange={setConfirm} placeholder="Type it again" label="Confirm passphrase" />
          <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
            Write the passphrase down: a new phone needs it to open these backups. Next, pick a folder. One
            that syncs somewhere else keeps your notes safe even if this phone is lost.
          </Text>
          {setupError ? (
            <Text className="font-sans text-sm" style={{ color: colors.error }}>
              {setupError}
            </Text>
          ) : null}
          <View className="flex-row gap-2 mt-1">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setPass('');
                setConfirm('');
                setStep({ kind: 'idle' });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="arrowRight"
              className="flex-1"
              disabled={pass.length < MIN_PASSPHRASE || pass !== confirm}
              onPress={chooseFolder}
            >
              {pass && confirm && pass !== confirm ? "Passphrases don't match" : 'Choose folder'}
            </Button>
          </View>
        </View>
      )}

      {step.kind === 'working' && (
        <View className="flex-row items-center py-2">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text className="font-sans-medium text-sm ml-3" style={{ color: colors.fgSecondary }}>
            {step.label}
          </Text>
        </View>
      )}

      {on && step.kind === 'idle' && (
        <View className="gap-3">
          <View>
            <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
              Every day, to {backup.folderName ? `“${backup.folderName}”` : 'the folder you chose'}.
            </Text>
            <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
              {backup.lastAt
                ? `Last backup ${formatDistanceToNowStrict(backup.lastAt, { addSuffix: true })}.`
                : 'No backup saved yet.'}
            </Text>
          </View>
          {backup.lastError ? (
            <View className="flex-row items-start">
              <Icon name="x" size={16} color={colors.error} stroke={2.4} />
              <Text className="flex-1 font-sans text-sm ml-2" style={{ color: colors.error }}>
                {backup.lastError}
              </Text>
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <Button variant="primary" size="sm" icon="archive" className="flex-1" onPress={() => backUpNow('Saving a backup…')}>
              Back up now
            </Button>
            <Button variant="quiet" size="sm" className="flex-1" onPress={() => setStep({ kind: 'setup' })}>
              Change folder
            </Button>
          </View>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              Haptics.selectionAsync();
              turnOffAutoBackup();
            }}
          >
            Turn off (files already saved stay)
          </Button>
        </View>
      )}
    </View>
  );
}
