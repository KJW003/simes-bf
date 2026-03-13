/**
 * Admin Settings - Manage Tariff Plans
 * Allows admins to create, read, update, and delete tariff plans
 * Including loss coefficients (alpha_a, beta_a, alpha_r, beta_r)
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import api from '@/lib/api';

export default function AdminTariffPlans() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<any>({
    group_code: 'SONABEL',
    plan_code: '',
    name: '',
    hp_start_min: 0,
    hp_end_min: 480,
    hpt_start_min: 480,
    hpt_end_min: 1440,
    rate_hp: 0,
    rate_hpt: 0,
    fixed_monthly: 0,
    prime_per_kw: 0,
    vat_rate: 0.18,
    tde_tdsaae_rate: 2,
    alpha_a: 0.015,
    beta_a: 0.04,
    alpha_r: 0.46,
    beta_r: 3.7,
    penalty_enabled: true,
  });

  // Fetch all plans
  const { data: plansData, isLoading } = useQuery({
    queryKey: ['admin-tariff-plans'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/tariff-plans`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch plans');
      return res.json();
    },
  });

  const plans = plansData?.plans || [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/tariff-plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create plan');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tariff-plans'] });
      setIsCreating(false);
      setFormData({
        group_code: 'SONABEL',
        plan_code: '',
        name: '',
        hp_start_min: 0,
        hp_end_min: 480,
        hpt_start_min: 480,
        hpt_end_min: 1440,
        rate_hp: 0,
        rate_hpt: 0,
        fixed_monthly: 0,
        prime_per_kw: 0,
        vat_rate: 0.18,
        tde_tdsaae_rate: 2,
        alpha_a: 0.015,
        beta_a: 0.04,
        alpha_r: 0.46,
        beta_r: 3.7,
        penalty_enabled: true,
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/tariff-plans/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to update plan');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tariff-plans'] });
      setEditingId(null);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/tariff-plans/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!res.ok) throw new Error('Failed to delete plan');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tariff-plans'] });
    },
  });

  const handleEdit = (plan: any) => {
    setEditingId(plan.id);
    setFormData(plan);
  };

  const handleSave = () => {
    if (editingId) {
      updateMutation.mutate(editingId);
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestion des plans tarifaires</h1>
        {!isCreating && !editingId && (
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nouveau plan
          </Button>
        )}
      </div>

      {/* Form */}
      {(isCreating || editingId) && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Modifier' : 'Créer'} un plan tarifaire</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Groupe</Label>
                <Input
                  value={formData.group_code}
                  onChange={(e) => setFormData({ ...formData, group_code: e.target.value })}
                />
              </div>
              <div>
                <Label>Code plan</Label>
                <Input
                  value={formData.plan_code}
                  onChange={(e) => setFormData({ ...formData, plan_code: e.target.value })}
                />
              </div>
              <div>
                <Label>Nom</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>HP Start (min)</Label>
                <Input
                  type="number"
                  value={formData.hp_start_min}
                  onChange={(e) => setFormData({ ...formData, hp_start_min: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>HP End (min)</Label>
                <Input
                  type="number"
                  value={formData.hp_end_min}
                  onChange={(e) => setFormData({ ...formData, hp_end_min: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>HPT Start (min)</Label>
                <Input
                  type="number"
                  value={formData.hpt_start_min}
                  onChange={(e) => setFormData({ ...formData, hpt_start_min: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>HPT End (min)</Label>
                <Input
                  type="number"
                  value={formData.hpt_end_min}
                  onChange={(e) => setFormData({ ...formData, hpt_end_min: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>Tarif HP</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.rate_hp}
                  onChange={(e) => setFormData({ ...formData, rate_hp: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Tarif HPT</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.rate_hpt}
                  onChange={(e) => setFormData({ ...formData, rate_hpt: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Prime fixe</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.fixed_monthly}
                  onChange={(e) => setFormData({ ...formData, fixed_monthly: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Prime/kW</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.prime_per_kw}
                  onChange={(e) => setFormData({ ...formData, prime_per_kw: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded border border-blue-200">
              <h3 className="font-medium text-sm mb-3">Coefficients de pertes (globaux SONABEL)</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs">α actif</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.alpha_a}
                    onChange={(e) => setFormData({ ...formData, alpha_a: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">β actif</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.beta_a}
                    onChange={(e) => setFormData({ ...formData, beta_a: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">α réactif</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.alpha_r}
                    onChange={(e) => setFormData({ ...formData, alpha_r: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">β réactif</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.beta_r}
                    onChange={(e) => setFormData({ ...formData, beta_r: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Enregistrer
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsCreating(false);
                  setEditingId(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans List */}
      <Card>
        <CardHeader>
          <CardTitle>Plans disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement...
            </div>
          ) : plans.length === 0 ? (
            <p className="text-muted-foreground">Aucun plan créé yet.</p>
          ) : (
            <div className="space-y-2">
              {plans.map((plan: any) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between p-3 border rounded hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <h3 className="font-medium">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {plan.plan_code} | HP: {plan.rate_hp} XOF | HPT: {plan.rate_hpt} XOF
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      α_a={plan.alpha_a} β_a={plan.beta_a} α_r={plan.alpha_r} β_r={plan.beta_r}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(plan)}
                      disabled={editingId !== null}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(plan.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
