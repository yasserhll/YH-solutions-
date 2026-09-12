<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Holiday;
use Illuminate\Http\Request;

class HolidayController extends Controller
{
    public function index()
    {
        return Holiday::orderBy('date')->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'date' => ['required', 'date', 'unique:holidays,date'],
            'name' => ['required', 'string', 'max:255'],
        ]);
        $data['created_by'] = $request->user()->id;

        return response()->json(Holiday::create($data), 201);
    }

    public function update(Request $request, Holiday $holiday)
    {
        $data = $request->validate([
            'date' => ['required', 'date', 'unique:holidays,date,'.$holiday->id],
            'name' => ['required', 'string', 'max:255'],
        ]);
        $holiday->update($data);

        return $holiday;
    }

    public function destroy(Holiday $holiday)
    {
        $holiday->delete();

        return response()->json(['message' => 'Jour férié supprimé.']);
    }
}
