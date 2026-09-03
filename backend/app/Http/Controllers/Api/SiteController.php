<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Site;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SiteController extends Controller
{
    public function index()
    {
        return Site::orderBy('name')->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:sites,name'],
        ]);
        $data['slug'] = Str::slug($data['name']);

        return response()->json(Site::create($data), 201);
    }

    public function update(Request $request, Site $site)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:sites,name,'.$site->id],
        ]);
        $data['slug'] = Str::slug($data['name']);
        $site->update($data);

        return $site;
    }

    public function destroy(Site $site)
    {
        $site->delete();

        return response()->json(['message' => 'Site supprimé.']);
    }
}
