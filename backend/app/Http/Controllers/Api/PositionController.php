<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Position;
use Illuminate\Http\Request;

class PositionController extends Controller
{
    public function index()
    {
        return Position::orderBy('name')->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:positions,name'],
        ]);

        return response()->json(Position::create($data), 201);
    }

    public function update(Request $request, Position $position)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:positions,name,'.$position->id],
        ]);
        $position->update($data);

        return $position;
    }

    public function destroy(Position $position)
    {
        $position->delete();

        return response()->json(['message' => 'Fonction supprimée.']);
    }
}
