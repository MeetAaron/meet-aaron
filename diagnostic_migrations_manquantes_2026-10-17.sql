-- DIAGNOSTIC (lecture seule) 17/10/2026 : migrations jamais lancées.
-- Colonnes et tables ajoutées par les fichiers migration_*.sql du dépôt
-- mais absentes de la base. Ne modifie rien.
WITH cols AS (
  SELECT split_part(x, '.', 1) AS t, split_part(x, '.', 2) AS c
  FROM unnest(string_to_array(
  'appointments.contact_name,appointments.created_at,appointments.debrief_email_body,appointm'
  || 'ents.debrief_email_sent_at,appointments.debrief_email_subject,appointments.debrief_generat'
  || 'ed_at,appointments.debrief_notes,appointments.debrief_summary,appointments.missed_action_a'
  || 'cknowledged,appointments.outcome,appointments.outcome_context,appointments.outcome_mood,ap'
  || 'pointments.outcome_note,appointments.outcome_recorded_at,appointments.pre_brief,appointmen'
  || 'ts.pre_brief_generated_at,appointments.purpose,appointments.source,appointments.thank_you_'
  || 'sent_at,availability_blocks.calendar_event_id,availability_blocks.calendar_provider,availa'
  || 'bility_blocks.external_event_id,availability_blocks.source,chat_messages.conversation_id,c'
  || 'ompanies.billing_address,companies.billing_country,companies.billing_exempt,companies.busi'
  || 'ness_summary,companies.business_summary_backup,companies.business_summary_backup_at,compan'
  || 'ies.business_summary_pending_file_name,companies.business_summary_pending_text,companies.b'
  || 'usiness_summary_pending_uploaded_at,companies.business_summary_pending_uploaded_by,compani'
  || 'es.credit_balance_ac_eur,companies.credit_balance_ap_eur,companies.credit_balance_as_eur,c'
  || 'ompanies.credit_balance_eur,companies.crm_auto_sync,companies.crm_connection_notes,compani'
  || 'es.crm_provider,companies.default_first_email_body,companies.default_first_email_enabled,c'
  || 'ompanies.default_first_email_subject,companies.devis_external_search_enabled,companies.dev'
  || 'is_template_storage_path,companies.external_conversion_webhook_secret,companies.invite_cod'
  || 'e,companies.invoice_next_number,companies.legal_address,companies.legal_form,companies.mon'
  || 'thly_api_cap_usd,companies.offer_ac_active,companies.offer_ap_active,companies.offer_as_ac'
  || 'tive,companies.prospecting_goal,companies.prospecting_goal_details,companies.public_link_u'
  || 'rl,companies.siret,companies.stripe_subscription_item_ac,companies.stripe_subscription_ite'
  || 'm_ap,companies.stripe_subscription_item_as,companies.subscription_grace_ends_at,companies.'
  || 'subscription_last_failure_reason,companies.subscription_past_due_since,companies.subscript'
  || 'ion_status,companies.vat_exempt_mention,companies.vat_number,company_documents.advice,comp'
  || 'any_documents.advice_generated_at,company_documents.attach_to_first_email,company_document'
  || 's.category_auto,company_documents.commercial_note,company_documents.included_in_aaron_cont'
  || 'ext,company_documents.language,company_documents.linked_category,company_documents.summary'
  || ',credit_boosts.consumed_usd,credit_transactions.module,crm_connections.instance_url,custom'
  || 'er_support_drafts.is_simple,email_verifications.expires_at,email_verifications.send_error,'
  || 'email_verifications.send_error_at,feedback_messages.context,feedback_messages.source,marke'
  || 'ting_campaigns.include_unsubscribe,messages.internet_message_id,messages.subject,oauth_con'
  || 'nections.auth_broken_at,oauth_connections.auth_broken_notified_at,oauth_connections.auth_f'
  || 'ailure_count,oauth_connections.dns_setup_email_sent_at,oauth_connections.domain_health_che'
  || 'cked_at,oauth_connections.domain_health_ok,oauth_connections.label_scope_notified_at,oauth'
  || '_connections.last_checked_at,oauth_connections.last_graph_error,oauth_connections.last_gra'
  || 'ph_error_at,oauth_connections.settings,prospect_companies.address,prospect_companies.compa'
  || 'ny_size,prospect_companies.estimated_revenue,prospect_companies.industry,prospect_companie'
  || 's.research_checked_at,prospect_companies.research_summary,prospect_companies.siret,prospec'
  || 't_companies.website,prospecting_campaigns.advice,prospecting_campaigns.advice_generated_at'
  || ',prospecting_campaigns.company_sizes,prospecting_campaigns.context_notes,prospecting_campa'
  || 'igns.ended_manually_at,prospecting_campaigns.quota_paused_at,prospecting_campaigns.target_'
  || 'locale,prospecting_campaigns.target_role,prospects.ai_managed,prospects.checkin_count,pros'
  || 'pects.churn_risk,prospects.contract_renewal_date,prospects.conviction_reason,prospects.con'
  || 'viction_score,prospects.conviction_updated_at,prospects.crm_synced_at,prospects.customer_h'
  || 'ealth_label,prospects.customer_health_score,prospects.customer_health_updated_at,prospects'
  || '.deal_stage,prospects.deal_stage_updated_at,prospects.devis_body,prospects.devis_call_done'
  || '_at,prospects.devis_check,prospects.devis_file_name,prospects.devis_file_path,prospects.de'
  || 'vis_file_type,prospects.devis_generated_at,prospects.devis_last_opened_at,prospects.devis_'
  || 'open_count,prospects.devis_opened_at,prospects.devis_recap,prospects.devis_sent_at,prospec'
  || 'ts.devis_subject,prospects.devis_track_token,prospects.devis_uploaded_at,prospects.email_b'
  || 'ounced_at,prospects.first_message_send_error,prospects.first_message_send_error_at,prospec'
  || 'ts.first_order_confirmed_at,prospects.handed_over_at,prospects.is_lost,prospects.kickoff_c'
  || 'all_body,prospects.kickoff_call_followup_sent_at,prospects.kickoff_call_proposed_at,prospe'
  || 'cts.kickoff_call_subject,prospects.last_checkin_response_at,prospects.last_checkin_sent_at'
  || ',prospects.linkedin_url,prospects.lost_at,prospects.marketing_opt_out,prospects.negotiatio'
  || 'n_confidence_reason,prospects.negotiation_confidence_score,prospects.negotiation_confidenc'
  || 'e_updated_at,prospects.onboarding_generated_at,prospects.onboarding_plan,prospects.onboard'
  || 'ing_status,prospects.onboarding_status_updated_at,prospects.origin,prospects.pending_first'
  || '_email_body,prospects.pending_first_email_generated_at,prospects.pending_first_email_subje'
  || 'ct,prospects.pipeline_lost_at_stage,prospects.pipeline_lost_reason,prospects.pipeline_risk'
  || ',prospects.pipeline_stage,prospects.pipeline_stage_updated_at,prospects.quote_paused_at,pr'
  || 'ospects.quote_requested_at,prospects.reactivation_batch_id,prospects.renewal_email_body,pr'
  || 'ospects.renewal_email_sent_at,prospects.renewal_email_subject,prospects.renewal_reminder_s'
  || 'ent_at,prospects.signature_completed_at,prospects.signature_external_link,prospects.signat'
  || 'ure_requested_at,prospects.signature_status,prospects.testimonial_email_body,prospects.tes'
  || 'timonial_email_sent_at,prospects.testimonial_email_subject,prospects.testimonial_requested'
  || '_at,prospects.upsell_dismissed_at,prospects.upsell_suggested_at,prospects.upsell_suggestio'
  || 'n,prospects.welcome_email_body,prospects.welcome_email_sent_at,prospects.welcome_email_sub'
  || 'ject,prospects.won_reason,prospects.youtrust_signature_request_id,push_subscriptions.user_'
  || 'agent,users.aaron_archive_threads,users.daily_prospecting_email_cap,users.email_banner_by_'
  || 'locale,users.email_banner_image_url,users.email_signature,users.email_signature_by_locale,'
  || 'users.email_signature_image_by_locale,users.email_signature_image_url,users.first_name,use'
  || 'rs.ics_feed_token,users.last_results_report_date,users.locale,users.meeting_link,users.not'
  || 'ify_before_appointment_minutes,users.notify_channel,users.onboarding_answers,users.onboard'
  || 'ing_step,users.onboarding_tour_seen,users.require_first_email_approval,users.timezone'
  , ',')) AS x
), tabs AS (
  SELECT t FROM unnest(string_to_array(
  'aaron_batch_items,aaron_batches,api_usage_daily,api_usage_monthly,api_usage_user_monthly,a'
  || 'vailability_blocks,availability_rules,business_summary_versions,chat_conversations,chat_me'
  || 'ssages,client_invoices,company_research_cache,credit_alerts,credit_boosts,credit_transacti'
  || 'ons,crm_connections,customer_checkins,customer_health_alerts,customer_support_drafts,deal_'
  || 'stage_alerts,directory_companies,email_send_counters,email_verifications,marketing_campaig'
  || 'n_recipients,marketing_campaigns,oauth_qr_tokens,password_reset_tokens,pending_aaron_repli'
  || 'es,products,push_subscriptions,quote_line_items,quotes,reactivation_batches,team_seats,use'
  || 'r_devices'
  , ',')) AS t
)
SELECT 'table manquante' AS probleme, t AS detail
FROM tabs WHERE to_regclass('public.' || t) IS NULL
UNION ALL
SELECT 'colonne manquante', t || '.' || c
FROM cols
WHERE to_regclass('public.' || t) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                  WHERE ic.table_schema = 'public' AND ic.table_name = cols.t AND ic.column_name = cols.c)
ORDER BY 1, 2;
