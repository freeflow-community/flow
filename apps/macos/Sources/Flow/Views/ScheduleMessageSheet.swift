import GRDB
import SwiftUI

/// Create / edit a scheduled message (#424) — the macOS twin of the web's
/// `ScheduleMessageModal`. One sheet, reached two ways: the Scheduled panel's
/// "New scheduled message", and the composer's clock (which prefills the
/// destination and whatever is already typed).
///
/// The schedule controls are presets rather than a cron box because that is
/// what people actually want — "daily at 9", "every 12 hours" — and because the
/// server stores the preset structurally, so reopening this sheet puts the same
/// controls back rather than a compiled cron string. Cron is still there as the
/// advanced escape hatch.
struct ScheduleMessageSheet: View {
    /// Which workspace's channels the "Post to" picker offers. Passed in
    /// rather than read from `WindowState` so the composer — which knows its
    /// own workspace and nothing about window navigation — can open this sheet.
    let workspaceId: String?
    let target: ScheduleEditorTarget
    /// Fired with the server's saved row — the panel settles it in place, the
    /// composer clears its draft.
    var onSaved: (ScheduledMessage) -> Void

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    /// Seeded from `target` in `init`, never from `load()`. These are the
    /// fields a person edits, and `load()` runs again every time the sheet's
    /// view reappears — on iOS that includes returning from the
    /// `.navigationLink` destination picker, which is how re-seeding them there
    /// wiped the typed body and reverted the channel just chosen. macOS's
    /// picker is inline and cannot reappear that way, but the two sheets should
    /// not differ in how they treat someone's input.
    @State private var body_: String
    @State private var form: ScheduleForm
    @State private var channelId: String
    /// Read from the local channel cache; safe to refresh at any time.
    @State private var destinations: [ScheduleDestinations.Choice] = []
    @State private var error: String?
    @State private var saving = false

    private var existing: ScheduledMessage? { target.existing }

    init(
        workspaceId: String?,
        target: ScheduleEditorTarget,
        onSaved: @escaping (ScheduledMessage) -> Void
    ) {
        self.workspaceId = workspaceId
        self.target = target
        self.onSaved = onSaved
        _body_ = State(initialValue: target.initialBody)
        _form = State(initialValue: ScheduleForm(existing: target.existing))
        // The preferred destination is known without touching the database; the
        // channel list only decides whether it is *offered* (and what to fall
        // back to), which `load()` settles.
        _channelId = State(initialValue: target.preferredChannelId ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(existing == nil ? "🕐 New scheduled message" : "🕐 Edit scheduled message")
                .flowFont(.headline)
                .accessibilityIdentifier("scheduleSheet.title")

            fieldLabel("Schedule").padding(.top, 16)
            scheduleControls
            Text(timezoneHelp)
                .flowFont(.caption)
                .foregroundStyle(MC.muted)
                .padding(.top, 4)

            fieldLabel("Message to post").padding(.top, 14)
            TextEditor(text: $body_)
                .flowFont(.callout)
                .frame(height: 86)
                .padding(4)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(MC.hairline2))
                .accessibilityIdentifier("scheduleSheet.body")

            fieldLabel("Post to").padding(.top, 14)
            destinationPicker

            Text("Posting to a channel makes this scheduled message visible to all of its members. "
                 + "It posts as you, marked as scheduled.")
                .flowFont(.caption)
                .foregroundStyle(MC.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)

            if let error {
                Text(error)
                    .flowFont(.callout)
                    .foregroundStyle(MC.danger)
                    .padding(.top, 10)
                    .accessibilityIdentifier("scheduleSheet.error")
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(existing == nil ? "Schedule it" : "Save changes") { Task { await save() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(saving)
                    .accessibilityIdentifier("scheduleSheet.save")
            }
            .padding(.top, 18)
        }
        .padding(20)
        .frame(width: 520)
        .task { await load() }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .flowFont(.caption, weight: .bold)
            .foregroundStyle(MC.inkSoft)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timezoneHelp: String {
        let base = "Runs in your timezone (\(ScheduleForm.localTimezone))."
        return form.kind == .cron ? base : base + " Switch to cron for advanced schedules."
    }

    // MARK: - Schedule controls

    private var scheduleControls: some View {
        HStack(spacing: 8) {
            Picker("", selection: $form.kind) {
                ForEach(Recurrence.Kind.allCases, id: \.self) { kind in
                    Text(kind.label).tag(kind)
                }
            }
            .labelsHidden()
            .frame(width: 150)
            .accessibilityIdentifier("scheduleSheet.kind")

            switch form.kind {
            case .once:
                DatePicker("", selection: $form.onceAt)
                    .labelsHidden()
                    .accessibilityIdentifier("scheduleSheet.onceAt")
            case .hourly:
                Picker("", selection: $form.minute) {
                    ForEach(ScheduleForm.hourlyMinutes, id: \.self) { m in
                        Text("at :\(String(format: "%02d", m))").tag(m)
                    }
                }
                .labelsHidden()
                .frame(width: 100)
                .accessibilityIdentifier("scheduleSheet.minute")
            case .everyNHours:
                Picker("", selection: $form.everyHours) {
                    ForEach(ScheduleForm.everyNChoices, id: \.self) { n in
                        Text("every \(n) hours").tag(n)
                    }
                }
                .labelsHidden()
                .frame(width: 130)
                .accessibilityIdentifier("scheduleSheet.everyHours")
                timePicker
            case .daily:
                timePicker
            case .weekly:
                Picker("", selection: $form.weekday) {
                    ForEach(Array(ScheduleFormat.weekdayNames.enumerated()), id: \.offset) { i, name in
                        Text(name).tag(i)
                    }
                }
                .labelsHidden()
                .frame(width: 110)
                .accessibilityIdentifier("scheduleSheet.weekday")
                timePicker
            case .cron:
                TextField("min hour dom mon dow", text: $form.cron)
                    .flowFont(.callout, design: .monospaced)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("scheduleSheet.cron")
            }
            Spacer(minLength: 0)
        }
    }

    private var timePicker: some View {
        DatePicker("", selection: $form.timeOfDay, displayedComponents: .hourAndMinute)
            .labelsHidden()
            .accessibilityIdentifier("scheduleSheet.time")
    }

    // MARK: - Destination

    private var destinationPicker: some View {
        // ScrollViewReader, because the list is fixed-height and the selection
        // is usually *not* at the top: opening this from the composer preselects
        // the current conversation, which in a workspace with a hundred channels
        // is forty rows down. Parked at the top it reads as "nothing was
        // prefilled" (#424).
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(destinations) { choice in
                        destinationRow(choice)
                    }
                }
            }
            // Once, when the choices land — not on every selection change, or
            // clicking a row would yank the list out from under the cursor.
            .onChange(of: destinations) { _, _ in
                guard !channelId.isEmpty else { return }
                proxy.scrollTo(channelId, anchor: .center)
            }
        }
        .frame(height: 116)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(MC.hairline2))
        .accessibilityIdentifier("scheduleSheet.destinations")
    }

    private func destinationRow(_ choice: ScheduleDestinations.Choice) -> some View {
        let selected = channelId == choice.id
        return Button { channelId = choice.id } label: {
            HStack(spacing: 8) {
                Circle()
                    .strokeBorder(selected ? MC.accent : MC.hairline2, lineWidth: 2)
                    .background(Circle().fill(selected ? MC.accent : .clear))
                    .frame(width: 12, height: 12)
                Text(choice.label)
                    .flowFont(.callout, weight: selected ? .semibold : .regular)
                    .foregroundStyle(selected ? MC.accentSoft : MC.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(choice.tag)
                    .flowFont(size: 10, weight: .semibold)
                    .foregroundStyle(MC.muted)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 3).fill(MC.daypill))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(selected ? MC.accent.opacity(0.1) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .id(choice.id)
        .accessibilityIdentifier("scheduleSheet.destination.\(choice.id)")
    }

    // MARK: - Load / save

    /// Refresh the destination list. Deliberately the *only* thing this does:
    /// it can run more than once over one sheet's life, so it must never
    /// overwrite something the person has entered — see
    /// `ScheduleDestinations.resolve`.
    private func load() async {
        let channels = (try? await app.db.reader.read { db in
            try Channel.filter(Column("workspaceId") == workspaceId).fetchAll(db)
        }) ?? []
        let choices = ScheduleDestinations.choices(channels: channels, me: app.currentUser?.id)
        destinations = choices
        channelId = ScheduleDestinations.resolve(
            current: channelId, preferred: target.preferredChannelId, choices: choices
        )
    }

    private func save() async {
        error = nil
        guard !body_.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Write the message you want posted"
            return
        }
        guard !channelId.isEmpty else {
            error = "Pick where it should post"
            return
        }
        let recurrence: Recurrence
        do {
            recurrence = try form.buildRecurrence()
        } catch {
            self.error = error.localizedDescription
            return
        }
        saving = true
        defer { saving = false }
        do {
            let saved: ScheduledMessage
            if let existing {
                saved = try await app.engine.updateScheduledMessage(
                    id: existing.id,
                    patch: UpdateScheduledMessageBody(
                        channelId: channelId, body: body_, recurrence: recurrence,
                        timezone: ScheduleForm.localTimezone
                    )
                )
            } else {
                saved = try await app.engine.createScheduledMessage(
                    channelId: channelId, body: body_, recurrence: recurrence,
                    timezone: ScheduleForm.localTimezone
                )
            }
            onSaved(saved)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.message ?? "Could not save this scheduled message"
        }
    }
}
