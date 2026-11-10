{{- define "zaplink.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "zaplink.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "zaplink.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "zaplink.labels" -}}
helm.sh/chart: {{ include "zaplink.chart" . }}
{{ include "zaplink.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "zaplink.selectorLabels" -}}
app.kubernetes.io/name: {{ include "zaplink.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "zaplink.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "zaplink.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "zaplink.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "zaplink.fullname" . }}
{{- end }}
{{- end }}

{{/*
An env/secretEnv value as a quoted string. A values file hands an unquoted number to the template as
a float64, and `quote` prints one of a million or more in exponent form ("5.24288e+07"), which the app
rejects or misreads. Whole numbers are printed as integers; anything else is quoted as given.
*/}}
{{- define "zaplink.envValue" -}}
{{- if and (kindIs "float64" .) (eq . (floor .)) -}}
{{- . | int64 | quote -}}
{{- else -}}
{{- . | quote -}}
{{- end -}}
{{- end }}
