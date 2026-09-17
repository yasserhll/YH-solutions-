<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport Journalier HSE</title>
<style>
    @page { margin: 14px 20px; }
    body { font-family: 'DejaVu Sans', sans-serif; font-size: 9.5px; line-height: 1.15; color: #000; margin: 0; }
    table { border-collapse: collapse; width: 100%; }

    /* Header band: logo | title | reference box */
    .header-table td { vertical-align: middle; padding: 0; }
    .logo-cell { width: 26%; }
    .logo-cell img { height: 34px; }
    .title-cell { width: 48%; text-align: center; }
    .title-cell h1 { font-size: 14px; margin: 0; letter-spacing: 0.5px; }
    .ref-cell { width: 26%; border: 1px solid #000; font-size: 7px; padding: 3px 5px; text-align: left; }
    .ref-cell div { line-height: 1.4; }

    /* Form table */
    .form-table { margin-top: 6px; border: 1px solid #000; }
    .form-table td { border: 1px solid #000; padding: 2.5px 6px; font-size: 9.5px; line-height: 1.15; vertical-align: top; }
    .label { font-weight: bold; width: 30%; }
    .label-narrow { font-weight: bold; width: 20%; }
    .value { width: 20%; }
    pre.value-text { margin: 0; font-family: 'DejaVu Sans', sans-serif; font-size: 9.5px; line-height: 1.15; white-space: pre-wrap; }

    .fill-gray1 { background-color: #F2F2F2; }
    .fill-gray2 { background-color: #C9C9C9; }
    .fill-green { background-color: #92D050; }
    .fill-gold { background-color: #FFD966; }
    .fill-blue { background-color: #8EAADB; }
    .fill-gray3 { background-color: #AEAAAA; }
    .fill-yellow { background-color: #FFFF00; }
    .fill-navy { background-color: #002060; color: #fff; }

    .center { text-align: center; }
    .note { margin-top: 5px; font-size: 8px; font-style: italic; }
</style>
</head>
<body>

<table class="header-table">
    <tr>
        <td class="logo-cell"><img src="{{ $logoPath }}"></td>
        <td class="title-cell"><h1>RAPPORT JOURNALIER HSE</h1></td>
        <td class="ref-cell">
            <div><strong>Référence :</strong> RJ-HSE-TRP-02</div>
            <div><strong>Version :</strong> B &nbsp; <strong>Date :</strong> 23/02/2026</div>
            <div><strong>Page</strong> 1 sur 1</div>
        </td>
    </tr>
</table>

<table class="form-table">
    <tr>
        <td class="label fill-gray1">Date :</td>
        <td class="value" colspan="3">{{ $report->report_date->format('d/m/Y') }}</td>
    </tr>
    <tr>
        <td class="label fill-gray1">Nom et prénom animateur HSE :</td>
        <td class="value" colspan="3">{{ $report->creator?->name }}</td>
    </tr>
    <tr>
        <td class="label fill-gray1">Projet/Site :</td>
        <td class="value" colspan="3">{{ $report->site?->name }}</td>
    </tr>
    <tr>
        <td class="label fill-gray2">Activités réalisées :</td>
        <td colspan="3"><pre class="value-text">{{ $report->activities }}</pre></td>
    </tr>
    <tr>
        <td class="label fill-green">Nombre SPA :</td>
        <td colspan="3" class="center">{{ $report->spa_count }}</td>
    </tr>
    <tr>
        <td class="label fill-green">Sujet(s) abordé(s)<br>(Sensibilisations / formations /<br>minute de sécurité) :</td>
        <td colspan="3"><pre class="value-text">{{ $report->topics_covered }}</pre></td>
    </tr>
    <tr>
        <td class="label fill-green">Nombre des participants :</td>
        <td colspan="3" class="center">{{ $report->participants_count }}</td>
    </tr>
    <tr>
        <td class="label fill-gold">Nombre des sanctions</td>
        <td colspan="3" class="center">{{ $report->sanctions_count }}</td>
    </tr>
    <tr>
        <td class="label fill-gold">Nombre des situations dangereuses</td>
        <td colspan="3" class="center">{{ $report->dangerous_situations_count }}</td>
    </tr>
    <tr>
        <td class="label fill-blue">Équipements inspectés :</td>
        <td colspan="3"><pre class="value-text">{{ $report->equipment_inspected }}</pre></td>
    </tr>
    <tr>
        <td class="label fill-blue">État général :</td>
        <td colspan="3">
            Conforme ( {{ $report->general_state === 'conforme' ? 'x' : '' }} ) &nbsp; / &nbsp;
            Non conforme ( {{ $report->general_state === 'non_conforme' ? 'x' : '' }} )
        </td>
    </tr>
    <tr>
        <td class="label fill-gray3">SOR : (Minimum de 4 SORs à<br>remonter)</td>
        <td colspan="3"><pre class="value-text">{{ $report->sor_notes ?: '-' }}</pre></td>
    </tr>
    <tr>
        <td class="label fill-gray3">Actions préventives/correctives :</td>
        <td colspan="3"><pre class="value-text">{{ $report->corrective_actions ?: '-' }}</pre></td>
    </tr>
    <tr>
        <td class="fill-gray1" colspan="2">Résultats des indicateurs clés de performance (KPI</td>
        <td class="fill-gray1 center">Résultats</td>
        <td class="fill-gray1 center">Commentaires</td>
    </tr>
    <tr>
        <td class="label fill-yellow" colspan="2">1- Nbre d'incidents :</td>
        <td class="center">{{ $report->incidents_count }}</td>
        <td>{{ $report->incidents_comment ?: '-' }}</td>
    </tr>
    <tr>
        <td class="label fill-yellow" colspan="2">2- Nbre d'accidents :</td>
        <td class="center">{{ $report->accidents_count }}</td>
        <td>{{ $report->accidents_comment ?: '-' }}</td>
    </tr>
    <tr>
        <td class="label fill-yellow" colspan="2">3- Impact environnemental :</td>
        <td class="center">{{ $report->environmental_impact_count }}</td>
        <td>{{ $report->environmental_impact_comment ?: '-' }}</td>
    </tr>
    <tr>
        <td class="label-narrow fill-green">Nombre d'effectifs de Shift :</td>
        <td class="value">{{ $report->shift_headcount ?? '-' }}</td>
        <td class="label-narrow fill-green">Nombre d'heures travaillées :</td>
        <td class="value">{{ $report->hours_worked ?? '-' }}</td>
    </tr>
    <tr>
        <td class="label-narrow fill-green">Taux de participation aux<br>Sensibilisations HSE :</td>
        <td class="value">{{ $report->sensitization_participation_rate !== null ? rtrim(rtrim(number_format((float) $report->sensitization_participation_rate, 2), '0'), '.') . '%' : '-' }}</td>
        <td class="label-narrow fill-green">Taux de clôture des actions<br>correctives :</td>
        <td class="value">{{ $report->corrective_actions_closure_rate !== null ? rtrim(rtrim(number_format((float) $report->corrective_actions_closure_rate, 2), '0'), '.') . '%' : '-' }}</td>
    </tr>
    <tr>
        <td class="label-narrow fill-green">Nombre de non-conformités :</td>
        <td class="value">{{ $report->non_conformities_count }}</td>
        <td class="label-narrow fill-green">Inductions HSE :</td>
        <td class="value">{{ $report->inductions_count }}</td>
    </tr>
    <tr>
        <td class="label-narrow fill-green">Nombre des Visites inspections /<br>Audits :</td>
        <td class="value">{{ $report->audits_count }}</td>
        <td class="label-narrow fill-green">Nombre des Exercices<br>d'évacuation d'urgence :</td>
        <td class="value">{{ $report->evacuation_drills_count }}</td>
    </tr>
    <tr>
        <td class="label fill-navy" colspan="4">Signature animateur HSE :</td>
    </tr>
</table>

<p class="note">NB : Ce rapport journalier doit être renseigné et communiqué chaque jour</p>

</body>
</html>
