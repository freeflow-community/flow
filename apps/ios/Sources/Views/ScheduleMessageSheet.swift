import GRDB
import SwiftUI

/// Create / edit a scheduled message (#424) — iOS's sheet, the same fields and
/// presets as the macOS sheet and the web dialog, laid out as a `Form` because
/// that is what a phone's grouped-list idiom is for.
///
/// Both entry points open this: the Scheduled list's `+`, and the composer's
/// clock (which prefills the typed text and the current conversation). The form
/// rules themselves live in the shared `ScheduleForm`, so "every 12 hours
/// starting 6:00 AM" cannot mean one thing here and another on the desktop.
struct ScheduleMessageSheet: View {
    let workspaceId: String?
    let target: ScheduleEditorTarget
    var onSaved: (ScheduledMessage) -> Void

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var body_: String = ""
    @State private var form = ScheduleForm()
    @State private var destinations: [ScheduleDestinations.Choice] = []
    @State private var channelId: String = ""
    @State private var error: String?
    @State private var saving = false

    private var existing: ScheduledMessage? { target.existing }

    var body: some View {
        Form {
            Section {
                Picker("Repeats", selection: $form.kind) {
                    ForEach(Recurrence.Kind.allCases, id: \.self) { kind in
                        Text(kind.label).tag(kind)
                    }
                }
                .accessibilityIdentifier("scheduleSheet.kind")
                scheduleDetail
            } header: {
                Text("Schedule")
            } footer: {
                Text(timezoneHelp)
            }

            Section("Message to post") {
                TextEditor(text: $body_)
                    .frame(minHeight: 90)
                    .accessibilityIdentifier("scheduleSheet.body")
            }

            // A `.navigationLink` Picker rather than the radio list macOS
            // draws: the destination is usually *not* the first choice —
            // opening this from the composer preselects the current
            // conversation, forty rows down in a busy workspace. A flat list
            // inside a Form can only be brought into view by scrolling the
            // whole form, which parks the sheet past the fields you came to
            // fill in. This states the choice in one row instead, and pushes
            // the full list only when you want to change it (#424).
            Section {
                Picker("Post to", selection: $channelId) {
                    ForEach(destinations) { choice in
                        HStack {
                            Text(choice.label)
                            Spacer()
                            Text(choice.tag)
                                .flowFont(.caption2)
                                .foregroundStyle(MC.muted)
                        }
                        .tag(choice.id)
                        .accessibilityIdentifier("scheduleSheet.destination.\(choice.id)")
                    }
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("scheduleSheet.destinations")
            } footer: {
                Text("Posting to a channel makes this scheduled message visible to all of its "
                     + "members. It posts as you, marked as scheduled.")
            }

            if let error {
                Section {
                    Text(error)
                        .foregroundStyle(MC.danger)
                        .accessibilityIdentifier("scheduleSheet.error")
                }
            }
        }
        .navigationTitle(existing == nil ? "New scheduled message" : "Edit scheduled message")
        .navigationBarTitleDisplayMode(.inline)
        .flowBarToolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(existing == nil ? "Schedule" : "Save") { Task { await save() } }
                    .disabled(saving)
                    .accessibilityIdentifier("scheduleSheet.save")
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var scheduleDetail: some View {
        switch form.kind {
        case .once:
            DatePicker("When", selection: $form.onceAt)
                .accessibilityIdentifier("scheduleSheet.onceAt")
        case .hourly:
            Picker("Minutes past", selection: $form.minute) {
                ForEach(ScheduleForm.hourlyMinutes, id: \.self) { m in
                    Text("at :\(String(format: "%02d", m))").tag(m)
                }
            }
            .accessibilityIdentifier("scheduleSheet.minute")
        case .everyNHours:
            Picker("How often", selection: $form.everyHours) {
                ForEach(ScheduleForm.everyNChoices, id: \.self) { n in
                    Text("every \(n) hours").tag(n)
                }
            }
            .accessibilityIdentifier("scheduleSheet.everyHours")
            timePicker("Starting")
        case .daily:
            timePicker("At")
        case .weekly:
            Picker("On", selection: $form.weekday) {
                ForEach(Array(ScheduleFormat.weekdayNames.enumerated()), id: \.offset) { i, name in
                    Text(name).tag(i)
                }
            }
            .accessibilityIdentifier("scheduleSheet.weekday")
            timePicker("At")
        case .cron:
            TextField("min hour dom mon dow", text: $form.cron)
                .flowFont(.callout, design: .monospaced)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("scheduleSheet.cron")
        }
    }

    private func timePicker(_ label: String) -> some View {
        DatePicker(label, selection: $form.timeOfDay, displayedComponents: .hourAndMinute)
            .accessibilityIdentifier("scheduleSheet.time")
    }

    private var timezoneHelp: String {
        let base = "Runs in your timezone (\(ScheduleForm.localTimezone))."
        return form.kind == .cron ? base : base + " Switch to cron for advanced schedules."
    }

    // MARK: - Load / save

    private func load() async {
        if case .creating(let prefill, _) = target { body_ = prefill }
        if let existing {
            body_ = existing.body
            form = ScheduleForm(existing: existing)
        }
        let channels = (try? await app.db.reader.read { db in
            try Channel.filter(Column("workspaceId") == workspaceId).fetchAll(db)
        }) ?? []
        destinations = ScheduleDestinations.choices(channels: channels, me: app.currentUser?.id)
        let preferred: String? = switch target {
        case .editing(let row): row.channelId
        case .creating(_, let channelId): channelId
        }
        channelId = destinations.first { $0.id == preferred }?.id ?? destinations.first?.id ?? ""
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
