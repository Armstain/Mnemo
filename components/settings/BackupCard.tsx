import React, { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import {
  BackupError,
  MIN_PASSPHRASE,
  backupFileName,
  openBackup,
  sealBackup,
  type BackupPayload,
} from '@/lib/backup';
import { noFocusRing } from '@/utils/web';
import { imageBase64, imagesOf } from '@/lib/images';

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
      // Photos go in too, so a restored note is whole.
      const images: Record<string, string> = {};
      for (const block of imagesOf(payload.entries)) {
        const data = block.file ? await imageBase64(block) : undefined;
        if (block.file && data) images[block.file] = data;
      }
      if (Object.keys(images).length > 0) payload.images = images;
      const text = await sealBackup(payload, pass, Crypto.getRandomBytes);
      await deliver(backupFileName(), text);
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
