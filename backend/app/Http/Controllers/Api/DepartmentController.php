<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Department;
use Illuminate\Http\Request;

class DepartmentController extends Controller
{
    public function index()
    {
        return Department::orderBy('name')->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:departments,name'],
        ]);

        return response()->json(Department::create($data), 201);
    }

    public function update(Request $request, Department $department)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:departments,name,'.$department->id],
        ]);
        $department->update($data);

        return $department;
    }

    public function destroy(Department $department)
    {
        $department->delete();

        return response()->json(['message' => 'Département supprimé.']);
    }
}
