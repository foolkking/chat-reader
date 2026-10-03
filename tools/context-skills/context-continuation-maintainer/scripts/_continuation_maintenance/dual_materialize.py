"""Materialize externally reconciled semantics against OLD state and NEW Raw.

The overlay and validation report are temporary implementation details. The only
published artifact is a new Context Package. No semantic decisions are inferred.
"""
import copy
import json
import os
from pathlib import Path
import tempfile

from _context_package.manifest import load_package_manifest
from _context_package.source import PackageSource, PackageError
from _context_package.validation import validate_continuation
from .model import MaintenanceError, load_json, normalize_sha256, sha256_bytes
from .package_update import compare_packages, member_inventory, inventory_digest


def _derived_members(source, manifest):
    result = {}
    for key, standard in [('current', 'continuation/current.md'), ('index', 'continuation/index.json')]:
        name = (manifest.continuation or {}).get(key, standard)
        if not isinstance(name, str) or not name.startswith('continuation/'):
            raise MaintenanceError('Continuation members must use the derived namespace for dual-package updates', 'derived_path_invalid')
        if source.exists(name):
            result[key] = (name, source.read_bytes(name))
    return result


def _validate_update_trace(trace, candidate, comparison, old_members):
    update = trace.get('package_update')
    if not isinstance(update, dict):
        raise MaintenanceError('Dual-package updates require package_update trace binding', 'update_binding_required')
    for name in ('previous_snapshot_sha256', 'new_snapshot_sha256'):
        if normalize_sha256(update.get(name)) != comparison[name]:
            raise MaintenanceError('A package changed since reconciliation', 'stale_maintenance_input')
    if update.get('supplementary_context_reviewed') is not True:
        raise MaintenanceError('Project context, notes, annotations and attachment changes require external review', 'supplementary_review_required')
    binding = trace.get('source_binding', {})
    for key, (_, content) in old_members.items():
        if normalize_sha256(binding.get(f'base_{key}_sha256')) != sha256_bytes(content):
            raise MaintenanceError('Trace does not bind the previous Continuation members', 'stale_maintenance_input')
    changed = comparison['first_changed_seq']
    end = candidate.get('coverage', {}).get('seq_end')
    if changed is None or not isinstance(end, int) or changed > end:
        return
    start = update.get('repair_from_seq')
    if not isinstance(start, int) or isinstance(start, bool) or start < 1 or start > changed:
        raise MaintenanceError('Historical edits require a repair boundary at or before the first changed message', 'repair_boundary_required')
    if candidate.get('maintenance_mode') != 'REPAIR':
        raise MaintenanceError('Historical edits in target coverage require REPAIR mode', 'repair_mode_required')
    baseline = trace.get('baseline', {})
    inherited = list(baseline.get('inherited_verified_ranges') or [])
    if baseline.get('inherited_verified_prefix'):
        inherited.append(baseline['inherited_verified_prefix'])
    safe_end = comparison['unchanged_prefix_last_seq']
    for span in inherited:
        if not isinstance(span, dict) or not isinstance(span.get('seq_end'), int) or safe_end is None or span['seq_end'] > min(safe_end, start - 1):
            raise MaintenanceError('Unchanged wording after a historical edit cannot inherit prior semantic coverage', 'affected_suffix_inheritance')


def _same_input(path, expected):
    try:
        with PackageSource(path) as source:
            if inventory_digest(member_inventory(source)) != expected:
                raise MaintenanceError('Source package changed before publication', 'concurrency_conflict')
    except (OSError, PackageError) as exc:
        raise MaintenanceError('Source package became unavailable before publication', 'concurrency_conflict') from exc


def materialize_package_update(previous_package, new_raw_package, *, candidate_path, maintenance_trace_path,
                               output_path, fragment_paths=None, validation_report_path=None):
    from .materialize import materialize_continuation
    output = Path(output_path).resolve()
    for name in (previous_package, new_raw_package):
        source = Path(name).resolve()
        if output == source or (source.is_dir() and output.is_relative_to(source)):
            raise MaintenanceError('Output must be outside both input packages', 'in_place_forbidden')
    if output.exists():
        raise MaintenanceError('Output already exists', 'output_exists')
    if not output.name.lower().endswith('.context.zip'):
        raise MaintenanceError('Output must end in .context.zip', 'output_type_invalid')
    if validation_report_path:
        raise MaintenanceError('Dual-package updates compute their own deterministic comparison report', 'external_report_not_used')

    comparison = compare_packages(previous_package, new_raw_package)
    trace, candidate = load_json(maintenance_trace_path), load_json(candidate_path)
    semantic_inputs = [(candidate_path, candidate), (maintenance_trace_path, trace)]
    semantic_inputs.extend((path, load_json(path)) for path in fragment_paths or [])
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.context-update-', dir=output.parent) as temp:
        work = Path(temp)
        overlay = work / 'overlay'
        overlay.mkdir()
        pinned_inputs = []
        for i, (_, content) in enumerate(semantic_inputs):
            path = work / f'input-{i}.json'
            path.write_text(json.dumps(content, ensure_ascii=False), encoding='utf-8')
            pinned_inputs.append(str(path))
        with PackageSource(previous_package) as old, PackageSource(new_raw_package) as new:
            old_manifest, new_manifest = load_package_manifest(old), load_package_manifest(new)
            old_members = _derived_members(old, old_manifest)
            if not old_members:
                raise MaintenanceError('Previous package has no Continuation; use the Raw-only workflow', 'previous_continuation_missing')
            new_members = _derived_members(new, new_manifest)
            if any(key not in old_members or value[1] != old_members[key][1] for key, value in new_members.items()):
                raise MaintenanceError('New Raw package contains a different Continuation; select the intended base explicitly', 'ambiguous_continuation_base')
            _validate_update_trace(trace, candidate, comparison, old_members)
            inventory = member_inventory(new)
            if inventory_digest(inventory) != comparison['new_snapshot_sha256'] or inventory_digest(member_inventory(old)) != comparison['previous_snapshot_sha256']:
                raise MaintenanceError('Source changed while preparing update', 'concurrency_conflict')
            removed = {name for name, _ in new_members.values()}
            for name in new.list_members():
                if name != 'manifest.json' and name not in removed:
                    new.copy_member(name, overlay / name)
            manifest = copy.deepcopy(new_manifest.raw)
            files = manifest.setdefault('files', {})
            for name in removed:
                files.pop(name, None)
            manifest['continuation'] = copy.deepcopy(old_manifest.continuation or {})
            for key, (_, content) in old_members.items():
                path = f'continuation/{"current.md" if key == "current" else "index.json"}'
                (overlay / path).parent.mkdir(exist_ok=True)
                (overlay / path).write_bytes(content)
                files[path] = {'sha256': sha256_bytes(content), 'byte_size': len(content)}
                manifest['continuation'][key] = path
            (overlay / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')

        # Validate the old Pair against NEW Raw, so inheritance never relies on
        # the old package's success report alone. Reports stay private to this run.
        report = validate_continuation(str(overlay), detail='full')
        report_path = work / 'validation.json'
        report_path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
        staged = work / 'updated.context.zip'
        result = materialize_continuation(str(overlay), candidate_path=pinned_inputs[0],
            maintenance_trace_path=pinned_inputs[1], output_path=str(staged),
            validation_report_path=str(report_path), fragment_paths=pinned_inputs[2:])
        with PackageSource(staged) as final:
            for name, info in inventory.items():
                if name == 'manifest.json' or name in removed:
                    continue
                if not final.exists(name) or final.sha256(name) != info['sha256'] or final.byte_size(name) != info['byte_size']:
                    raise MaintenanceError('Output changed a NEW Raw package member', 'raw_immutability_failure')
            new_assets = {name for name in inventory if name.startswith('assets/')}
            if {name for name in final.list_members() if name.startswith('assets/')} != new_assets:
                raise MaintenanceError('Output asset inventory differs from NEW Raw', 'raw_immutability_failure')
        _same_input(previous_package, comparison['previous_snapshot_sha256'])
        _same_input(new_raw_package, comparison['new_snapshot_sha256'])
        for path, pinned in semantic_inputs:
            if load_json(path) != pinned:
                raise MaintenanceError('Semantic input changed before publication', 'concurrency_conflict')
        try:
            # Same-volume hard-link publication is atomic and refuses an output
            # created concurrently; replace() would silently overwrite it.
            os.link(staged, output)
        except FileExistsError as exc:
            raise MaintenanceError('Output appeared before publication', 'output_exists') from exc
        result.update(source_package=str(Path(new_raw_package).resolve()),
                      previous_package=str(Path(previous_package).resolve()), output_package=str(output),
                      package_update=comparison)
        return result
