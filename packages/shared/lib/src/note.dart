import 'package:meta/meta.dart';

/// Who a note is visible to. Mirrored by `firestore.rules`.
enum NoteVisibility {
  private,
  shared;

  static NoteVisibility fromWire(Object? value) {
    return NoteVisibility.values.firstWhere(
      (v) => v.name == value,
      orElse: () => NoteVisibility.private,
    );
  }
}

/// The moderation state of a note.
///
/// This is a *server-owned* field: only a Cloud Function running with the Admin
/// SDK may write it. Both `firestore.rules` and the callable Function enforce
/// that; the enum exists on the client only so the UI can render the state.
enum ReviewState {
  pending,
  approved,
  rejected;

  static ReviewState fromWire(Object? value) {
    return ReviewState.values.firstWhere((v) => v.name == value, orElse: () => ReviewState.pending);
  }
}

/// A single product-neutral document in the `notes` collection.
@immutable
class Note {
  const Note({
    required this.id,
    required this.ownerId,
    required this.title,
    required this.body,
    required this.visibility,
    required this.createdAt,
    this.reviewState = ReviewState.pending,
    this.reviewedBy,
    this.reviewedAt,
  });

  /// Builds a [Note] from a Firestore document payload.
  factory Note.fromMap(String id, Map<String, Object?> data) {
    return Note(
      id: id,
      ownerId: (data['ownerId'] as String?) ?? '',
      title: (data['title'] as String?) ?? '',
      body: (data['body'] as String?) ?? '',
      visibility: NoteVisibility.fromWire(data['visibility']),
      createdAt: _asDate(data['createdAt']),
      reviewState: ReviewState.fromWire(data['reviewState']),
      reviewedBy: data['reviewedBy'] as String?,
      reviewedAt: data['reviewedAt'] == null ? null : _asDate(data['reviewedAt']),
    );
  }

  final String id;
  final String ownerId;
  final String title;
  final String body;
  final NoteVisibility visibility;
  final DateTime createdAt;
  final ReviewState reviewState;
  final String? reviewedBy;
  final DateTime? reviewedAt;

  /// The payload a *client* is allowed to send when creating a note.
  ///
  /// Note that the server-owned fields are absent by construction: the client
  /// cannot accidentally include them, `firestore.rules` rejects them if it
  /// tries, and the rules unit tests prove the rejection.
  Map<String, Object?> toCreatePayload() => <String, Object?>{
    'ownerId': ownerId,
    'title': title,
    'body': body,
    'visibility': visibility.name,
    'createdAt': createdAt.toUtc().toIso8601String(),
  };

  /// The payload a *client* is allowed to send when editing its own note.
  Map<String, Object?> toClientUpdatePayload() => <String, Object?>{
    'title': title,
    'body': body,
    'visibility': visibility.name,
  };

  Note copyWith({
    String? title,
    String? body,
    NoteVisibility? visibility,
    ReviewState? reviewState,
    String? reviewedBy,
    DateTime? reviewedAt,
  }) {
    return Note(
      id: id,
      ownerId: ownerId,
      title: title ?? this.title,
      body: body ?? this.body,
      visibility: visibility ?? this.visibility,
      createdAt: createdAt,
      reviewState: reviewState ?? this.reviewState,
      reviewedBy: reviewedBy ?? this.reviewedBy,
      reviewedAt: reviewedAt ?? this.reviewedAt,
    );
  }

  static DateTime _asDate(Object? value) {
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value)?.toUtc() ?? DateTime.utc(1970);
    if (value is int) return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
    return DateTime.utc(1970);
  }

  @override
  bool operator ==(Object other) =>
      other is Note &&
      other.id == id &&
      other.ownerId == ownerId &&
      other.title == title &&
      other.body == body &&
      other.visibility == visibility &&
      other.reviewState == reviewState;

  @override
  int get hashCode => Object.hash(id, ownerId, title, body, visibility, reviewState);
}
